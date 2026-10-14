import { Router } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireAdmin } from '../middleware/auth.js';
import { newPublicId, newStaticSig, linkUrl } from '../services/tokens.js';
import { parseQuestionDefinitions, CHANNELS, normalizeChannel } from '../services/questions.js';
import { getLatestVersion, parseJson } from '../services/links.js';
import { getStats, clearStatsCache } from '../services/aggregate.js';

export const adminRouter = Router();

// hash หลอกไว้เทียบเวลา ให้การล็อกอินด้วยชื่อที่ไม่มีอยู่ใช้เวลาใกล้เคียงของจริง
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const validationError = (res, err) => res.status(422).json({ error: 'validation', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

// ---------- auth ----------
adminRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const user = await db('admin_users').where({ username: parsed.data.username }).first();
  const ok = await bcrypt.compare(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' });

  // สร้าง session ใหม่หลังล็อกอิน กัน session fixation
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'internal_error' });
    req.session.adminId = user.id;
    req.session.username = user.username;
    req.session.save(() => res.json({ ok: true, username: user.username }));
  });
});

adminRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('rv.sid');
    res.json({ ok: true });
  });
});

adminRouter.get('/me', (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'unauthorized' });
  res.json({ username: req.session.username });
});

// ต่อจากนี้ต้องล็อกอินทั้งหมด
adminRouter.use(requireAdmin);

adminRouter.post('/change-password', async (req, res) => {
  const parsed = z.object({ current: z.string().min(1), next: z.string().min(10).max(200) }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const user = await db('admin_users').where({ id: req.session.adminId }).first();
  if (!(await bcrypt.compare(parsed.data.current, user.password_hash))) return res.status(401).json({ error: 'invalid_credentials' });
  await db('admin_users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(parsed.data.next, 12) });
  res.json({ ok: true });
});

// ---------- branches ----------
const branchSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/, 'รหัสสาขาใช้ได้เฉพาะ A-Z 0-9 _ - (2-32 ตัว)'),
  name: z.string().trim().min(1).max(120),
});

adminRouter.get('/branches', async (_req, res) => {
  const rows = await db('branches').orderBy('code');
  res.json(rows.map((b) => ({ id: b.id, code: b.code, name: b.name, isActive: !!b.is_active })));
});

adminRouter.post('/branches', async (req, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  if (await db('branches').where({ code: parsed.data.code }).first()) return res.status(409).json({ error: 'duplicate_code' });
  const [id] = await db('branches').insert(parsed.data);
  res.status(201).json({ id, ...parsed.data, isActive: true });
});

adminRouter.patch('/branches/:id', async (req, res) => {
  const parsed = branchSchema.partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { isActive, ...rest } = parsed.data;
  const patch = { ...rest, ...(isActive === undefined ? {} : { is_active: isActive }) };
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
  if (patch.code && (await db('branches').where({ code: patch.code }).whereNot({ id: req.params.id }).first())) {
    return res.status(409).json({ error: 'duplicate_code' });
  }
  const n = await db('branches').where({ id: req.params.id }).update(patch);
  if (!n) return res.status(404).json({ error: 'not_found' });
  clearStatsCache();
  res.json({ ok: true });
});

// ---------- survey (คำถาม) ----------
async function activeSurvey() {
  return db('surveys').where({ status: 'active' }).orderBy('id').first();
}

adminRouter.get('/survey', async (_req, res) => {
  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });
  const version = await getLatestVersion(survey.id);
  const versions = await db('survey_versions').where({ survey_id: survey.id }).orderBy('version_no', 'desc').select('version_no', 'published_at');
  res.json({
    id: survey.id,
    title: survey.title,
    version: version.version_no,
    questions: version.questions,
    settings: version.settings,
    versions,
  });
});

// เผยแพร่ = สร้างเวอร์ชันใหม่ (ของเก่าไม่ถูกแก้ จึงไม่กระทบคำตอบที่เก็บไปแล้ว)
adminRouter.post('/survey/publish', async (req, res) => {
  const parsed = z
    .object({ title: z.string().trim().min(1).max(200).optional(), questions: z.unknown(), settings: z.record(z.string(), z.unknown()).optional() })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  let questions;
  try {
    questions = parseQuestionDefinitions(parsed.data.questions);
  } catch (err) {
    if (err instanceof z.ZodError) return validationError(res, err);
    throw err;
  }

  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });

  const result = await db.transaction(async (trx) => {
    const last = await trx('survey_versions').where({ survey_id: survey.id }).max({ n: 'version_no' }).first();
    const versionNo = Number(last?.n ?? 0) + 1;
    const previous = await getLatestVersion(survey.id, trx);
    await trx('survey_versions').insert({
      survey_id: survey.id,
      version_no: versionNo,
      questions: JSON.stringify(questions),
      settings: JSON.stringify(parsed.data.settings ?? previous?.settings ?? {}),
      published_at: trx.fn.now(3),
    });
    if (parsed.data.title) await trx('surveys').where({ id: survey.id }).update({ title: parsed.data.title });
    return versionNo;
  });
  clearStatsCache();
  res.status(201).json({ ok: true, version: result });
});

// ---------- links ----------
const serializeLink = (l, branchMap) => ({
  id: l.id,
  kind: l.kind,
  channel: l.channel ?? null,
  label: l.label,
  branchId: l.branch_id,
  branchName: l.branch_id ? branchMap.get(l.branch_id) ?? null : null,
  isActive: !!l.is_active,
  expiresAt: l.expires_at ? new Date(l.expires_at).toISOString() : null,
  lastUsedAt: l.last_used_at ? new Date(l.last_used_at).toISOString() : null,
  hitCount: l.hit_count,
  tokenVersion: l.token_version,
  createdAt: new Date(l.created_at).toISOString(),
  url: linkUrl(l),
});

adminRouter.get('/links', async (req, res) => {
  const branches = await db('branches');
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const rows = await db('share_links')
    .modify((q) => {
      if (req.query.branch_id) q.where({ branch_id: Number(req.query.branch_id) });
      if (req.query.kind === 'customer' || req.query.kind === 'dashboard') q.where({ kind: req.query.kind });
    })
    .orderBy('created_at', 'desc');
  res.json(rows.map((l) => serializeLink(l, branchMap)));
});

adminRouter.post('/links', async (req, res) => {
  const parsed = z
    .object({
      kind: z.enum(['customer', 'dashboard']),
      channel: z.enum(CHANNELS).nullable().optional(),
      branchId: z.number().int().positive().nullable().optional(),
      label: z.string().trim().min(1).max(200),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { kind, label } = parsed.data;
  const branchId = parsed.data.branchId ?? null;
  // ลิงก์ลูกค้าต้องเลือกช่องทาง (หน้าร้าน/ออนไลน์) — ลิงก์ผู้บริหารไม่ผูกช่องทาง (กรองใน Dashboard ได้)
  const channel = kind === 'customer' ? parsed.data.channel ?? null : null;

  if (kind === 'customer' && !branchId) return res.status(422).json({ error: 'validation', issues: [{ path: 'branchId', message: 'ลิงก์ลูกค้าต้องระบุสาขา' }] });
  if (kind === 'customer' && !channel) return res.status(422).json({ error: 'validation', issues: [{ path: 'channel', message: 'ลิงก์ลูกค้าต้องเลือกช่องทาง (หน้าร้าน/ออนไลน์)' }] });
  if (branchId && !(await db('branches').where({ id: branchId }).first())) return res.status(404).json({ error: 'branch_not_found' });

  const survey = await activeSurvey();
  const publicId = newPublicId();
  const [id] = await db('share_links').insert({
    public_id: publicId,
    survey_id: survey.id,
    kind,
    channel,
    static_sig: kind === 'customer' ? newStaticSig() : null, // QR ลูกค้าคงที่ตลอดอายุลิงก์
    branch_id: branchId,
    label,
    expires_at: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });
  const link = await db('share_links').where({ id }).first();
  const branches = await db('branches');
  res.status(201).json(serializeLink(link, new Map(branches.map((b) => [b.id, b.name]))));
});

adminRouter.patch('/links/:id', async (req, res) => {
  const parsed = z
    .object({ label: z.string().trim().min(1).max(200).optional(), isActive: z.boolean().optional(), expiresAt: z.string().datetime().nullable().optional() })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const patch = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
  if (parsed.data.expiresAt !== undefined) patch.expires_at = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
  const n = await db('share_links').where({ id: req.params.id }).update(patch);
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// หมุนเวียน (เฉพาะลิงก์ผู้บริหาร): เพิ่ม token_version ทำให้ลิงก์เดิมใช้ไม่ได้ทันที
// ลิงก์ลูกค้า (QR) คงที่ตลอดอายุ — ถ้าต้องการ QR ใหม่ให้ลบลิงก์แล้วสร้างใหม่
adminRouter.post('/links/:id/rotate', async (req, res) => {
  const current = await db('share_links').where({ id: req.params.id }).first();
  if (!current) return res.status(404).json({ error: 'not_found' });
  if (current.kind === 'customer') return res.status(409).json({ error: 'static_qr', message: 'QR ลูกค้าเปลี่ยนไม่ได้ — ลบลิงก์แล้วสร้างใหม่แทน' });
  await db('share_links').where({ id: req.params.id }).increment('token_version', 1);
  const link = await db('share_links').where({ id: req.params.id }).first();
  const branches = await db('branches');
  res.json(serializeLink(link, new Map(branches.map((b) => [b.id, b.name]))));
});

// ลบลิงก์ถาวร: QR/ลิงก์ใช้ไม่ได้ทันที แต่รีวิวที่ส่งผ่านลิงก์นี้ยังอยู่ (ปลดการอ้างอิง link_id ก่อนลบ)
adminRouter.delete('/links/:id', async (req, res) => {
  const deleted = await db.transaction(async (trx) => {
    await trx('responses').where({ link_id: req.params.id }).update({ link_id: null });
    return trx('share_links').where({ id: req.params.id }).del();
  });
  if (!deleted) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

adminRouter.get('/links/:id/qr', async (req, res) => {
  const link = await db('share_links').where({ id: req.params.id }).first();
  if (!link) return res.status(404).json({ error: 'not_found' });
  const url = linkUrl(link);
  const filename = `qr-${link.public_id}`;
  const opts = { errorCorrectionLevel: 'M', margin: 2 };

  res.set('Cache-Control', 'no-store');
  if (req.query.format === 'png') {
    const png = await QRCode.toBuffer(url, { ...opts, width: 1024 });
    res.type('png');
    if (req.query.download) res.attachment(`${filename}.png`);
    return res.send(png);
  }
  const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
  res.type('image/svg+xml');
  if (req.query.download) res.attachment(`${filename}.svg`);
  res.send(svg);
});

// ---------- stats & responses ----------
adminRouter.get('/stats', async (req, res) => {
  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });
  const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
  const stats = await getStats({ surveyId: survey.id, branchId, channel: normalizeChannel(req.query.channel), range: req.query.range });
  res.json({ title: survey.title, scope: branchId ? stats.branches[0]?.name ?? '' : 'ทุกสาขา', ...stats });
});

adminRouter.get('/responses', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;
  const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
  const channel = normalizeChannel(req.query.channel);

  const base = () =>
    db('responses as r').modify((q) => {
      if (branchId) q.where('r.branch_id', branchId);
      if (channel) q.where('r.channel', channel);
    });
  const [{ n: total }] = await base().count({ n: '*' });
  const rows = await base()
    .leftJoin('branches as b', 'b.id', 'r.branch_id')
    .leftJoin('share_links as l', 'l.id', 'r.link_id')
    .orderBy('r.submitted_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .select('r.id', 'r.submitted_at', 'r.version_id', 'r.channel', 'b.name as branch', 'l.label as link');

  const answers = rows.length
    ? await db('answers').whereIn('response_id', rows.map((r) => r.id))
    : [];
  const byResponse = new Map();
  for (const a of answers) {
    const list = byResponse.get(a.response_id) ?? {};
    list[a.question_key] = a.value_number != null ? Number(a.value_number) : a.value_text ?? parseJson(a.value_json);
    byResponse.set(a.response_id, list);
  }

  res.json({
    page,
    pageSize,
    total: Number(total),
    items: rows.map((r) => ({
      id: r.id,
      submittedAt: new Date(r.submitted_at).toISOString(),
      branch: r.branch,
      channel: r.channel,
      link: r.link,
      answers: byResponse.get(r.id) ?? {},
    })),
  });
});
