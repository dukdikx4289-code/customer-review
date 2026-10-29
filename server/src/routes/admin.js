import { Router } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireAdmin } from '../middleware/auth.js';
import { newPublicId, newStaticSig, linkUrl } from '../services/tokens.js';
import { parseQuestionDefinitions, LINK_CHANNELS, normalizeChannel, shortLabel } from '../services/questions.js';
import { getLatestVersion, parseJson } from '../services/links.js';
import { getStats, clearStatsCache } from '../services/aggregate.js';
import { responseDetail } from '../services/responses.js';
import { NOTIFY_MODES, getNotifySettings, setNotifySettings, notifyStats } from '../services/notify.js';

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
  res.json(rows.map((b) => ({ id: b.id, code: b.code, name: b.name, isActive: !!b.is_active, customForm: !!b.custom_form })));
});

adminRouter.post('/branches', async (req, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  if (await db('branches').where({ code: parsed.data.code }).first()) return res.status(409).json({ error: 'duplicate_code' });
  // สาขาใหม่ได้ฟอร์มของตัวเองทันที (สำเนาจากแม่แบบ) — แก้แยกได้โดยไม่กระทบสาขาอื่น
  const survey = await activeSurvey();
  const id = await db.transaction(async (trx) => {
    const [branchId] = await trx('branches').insert({ ...parsed.data, custom_form: true });
    const template = survey ? await getLatestVersion(survey.id, { database: trx }) : null;
    if (template) await publishVersion(trx, survey.id, branchId, template.questions, template.settings);
    return branchId;
  });
  res.status(201).json({ id, ...parsed.data, isActive: true, customForm: true });
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

/** เผยแพร่เวอร์ชันใหม่ (branchId = null คือแม่แบบสำหรับสาขาใหม่) — version_no นับรวมทั้งแบบสอบถาม */
async function publishVersion(trx, surveyId, branchId, questions, settings) {
  const last = await trx('survey_versions').where({ survey_id: surveyId }).max({ n: 'version_no' }).first();
  const versionNo = Number(last?.n ?? 0) + 1;
  await trx('survey_versions').insert({
    survey_id: surveyId,
    branch_id: branchId,
    version_no: versionNo,
    questions: JSON.stringify(questions),
    settings: JSON.stringify(settings ?? {}),
    published_at: trx.fn.now(3),
  });
  return versionNo;
}

// ฟอร์มที่จะดู/แก้: ?branch_id= ว่าง = ฟอร์มกลาง, มีค่า = ฟอร์มของสาขานั้น
// ตอบ mode: 'template' (แม่แบบสำหรับสาขาใหม่ — ไม่มีสาขาไหนใช้ตรงๆ) | 'custom' (ฟอร์มของสาขา) | 'inherit' (สาขาเก่าที่ยังไม่แยก — กรณีพิเศษ)
adminRouter.get('/survey', async (req, res) => {
  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });
  const branchId = Number(req.query.branch_id) || null;
  const branch = branchId ? await db('branches').where({ id: branchId }).first() : null;
  if (branchId && !branch) return res.status(404).json({ error: 'branch_not_found' });

  const mode = !branch ? 'template' : branch.custom_form ? 'custom' : 'inherit';
  const version = await getLatestVersion(survey.id, { branchId });
  const versions = await db('survey_versions')
    .where({ survey_id: survey.id })
    .modify((q) => (mode === 'custom' ? q.where('branch_id', branchId) : q.whereNull('branch_id')))
    .orderBy('version_no', 'desc')
    .select('version_no', 'published_at');
  const customBranches = await db('branches').where({ custom_form: true }).select('id');
  res.json({
    id: survey.id,
    title: survey.title,
    mode,
    branch: branch ? { id: branch.id, name: branch.name } : null,
    customBranchIds: customBranches.map((b) => b.id),
    version: version.version_no,
    questions: version.questions,
    settings: version.settings,
    versions,
  });
});

// (API สำรอง ไม่มีปุ่มใน UI) สาขาใช้ฟอร์มของตัวเอง (custom: true) — ครั้งแรกคัดลอกแม่แบบ; false = ใช้แม่แบบ (เวอร์ชันของสาขายังเก็บไว้)
adminRouter.post('/survey/branch-mode', async (req, res) => {
  const parsed = z.object({ branchId: z.number().int().positive(), custom: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { branchId, custom } = parsed.data;
  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });
  if (!(await db('branches').where({ id: branchId }).first())) return res.status(404).json({ error: 'branch_not_found' });

  await db.transaction(async (trx) => {
    if (custom) {
      const own = await trx('survey_versions').where({ survey_id: survey.id, branch_id: branchId }).first('id');
      if (!own) {
        const template = await getLatestVersion(survey.id, { database: trx });
        await publishVersion(trx, survey.id, branchId, template.questions, template.settings);
      }
    }
    await trx('branches').where({ id: branchId }).update({ custom_form: custom });
  });
  clearStatsCache();
  res.json({ ok: true, mode: custom ? 'custom' : 'inherit' });
});

// เผยแพร่ = สร้างเวอร์ชันใหม่ (ของเก่าไม่ถูกแก้ จึงไม่กระทบคำตอบที่เก็บไปแล้ว)
// branchId = ฟอร์มของสาขานั้น, ไม่ระบุ = แม่แบบสำหรับสาขาใหม่ — ชื่อแบบสอบถาม (title) ใช้ร่วมกัน แก้ได้ที่แม่แบบเท่านั้น
adminRouter.post('/survey/publish', async (req, res) => {
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      branchId: z.number().int().positive().nullable().optional(),
      questions: z.unknown(),
      // ข้อความหลังส่ง: sentTitle = หน้าส่งสำเร็จ (ขึ้นสั้นๆ) → thanksTitle + thankYou = หน้าขอบคุณสุดท้าย
      settings: z
        .object({
          sentTitle: z.string().trim().max(120).optional(),
          thanksTitle: z.string().trim().max(200).optional(),
          thankYou: z.string().trim().max(600).optional(),
        })
        .passthrough()
        .optional(),
    })
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
  const branchId = parsed.data.branchId ?? null;
  if (branchId) {
    const branch = await db('branches').where({ id: branchId }).first();
    if (!branch) return res.status(404).json({ error: 'branch_not_found' });
    if (!branch.custom_form) return res.status(409).json({ error: 'branch_uses_central_form', message: 'เปิด "ใช้ฟอร์มของสาขานี้เอง" ก่อนเผยแพร่' });
  }

  const result = await db.transaction(async (trx) => {
    const previous = await getLatestVersion(survey.id, { branchId, database: trx });
    const versionNo = await publishVersion(trx, survey.id, branchId, questions, parsed.data.settings ?? previous?.settings);
    if (parsed.data.title && !branchId) await trx('surveys').where({ id: survey.id }).update({ title: parsed.data.title });
    return versionNo;
  });
  clearStatsCache();
  res.status(201).json({ ok: true, version: result });
});

// คัดลอกฟอร์ม (สาขาต้นทาง หรือแม่แบบเมื่อ fromBranchId = null) ไปยังหลายสาขา — เผยแพร่เป็นเวอร์ชันใหม่ของแต่ละสาขาปลายทาง
adminRouter.post('/survey/copy', async (req, res) => {
  const parsed = z
    .object({ fromBranchId: z.number().int().positive().nullable(), toBranchIds: z.array(z.number().int().positive()).min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const survey = await activeSurvey();
  if (!survey) return res.status(404).json({ error: 'not_found' });
  const { fromBranchId } = parsed.data;
  const targets = [...new Set(parsed.data.toBranchIds)].filter((id) => id !== fromBranchId);
  const found = await db('branches').whereIn('id', targets).pluck('id');
  if (found.length !== targets.length) return res.status(404).json({ error: 'branch_not_found' });

  const copied = await db.transaction(async (trx) => {
    const source = await getLatestVersion(survey.id, { branchId: fromBranchId, database: trx });
    for (const id of targets) {
      await publishVersion(trx, survey.id, id, source.questions, source.settings);
      await trx('branches').where({ id }).update({ custom_form: true });
    }
    return targets.length;
  });
  clearStatsCache();
  res.json({ ok: true, copied });
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
      channel: z.enum(LINK_CHANNELS).nullable().optional(),
      branchId: z.number().int().positive().nullable().optional(),
      label: z.string().trim().min(1).max(200),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { kind, label } = parsed.data;
  const branchId = parsed.data.branchId ?? null;
  // ลิงก์ลูกค้า: ค่าเริ่มต้น 'choose' (QR เดียว ลูกค้าเลือกหน้าร้าน/ออนไลน์เอง) หรือผูกช่องทาง — ลิงก์ผู้บริหารไม่ผูกช่องทาง (กรองใน Dashboard)
  const channel = kind === 'customer' ? parsed.data.channel ?? 'choose' : null;

  if (kind === 'customer' && !branchId) return res.status(422).json({ error: 'validation', issues: [{ path: 'branchId', message: 'ลิงก์ลูกค้าต้องระบุสาขา' }] });
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
    .object({
      label: z.string().trim().min(1).max(200).optional(),
      isActive: z.boolean().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      channel: z.enum(LINK_CHANNELS).optional(), // เปลี่ยนช่องทางของ QR เดิมได้ — รหัสใน QR ไม่เปลี่ยน
    })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const patch = {};
  if (parsed.data.channel !== undefined) {
    const link = await db('share_links').where({ id: req.params.id }).first('kind');
    if (!link) return res.status(404).json({ error: 'not_found' });
    if (link.kind !== 'customer') return res.status(422).json({ error: 'validation', issues: [{ path: 'channel', message: 'ลิงก์ผู้บริหารไม่ผูกช่องทาง' }] });
    patch.channel = parsed.data.channel;
  }
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

// ตัวกรองคำตอบ (ใช้ทั้งดูรายการและ "ลบทั้งหมดตามตัวกรอง"): วันที่เป็นวันตามเวลาไทย YYYY-MM-DD (to = รวมทั้งวัน)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const bkkDayStart = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 3_600_000);

function parseResponseFilter(src) {
  return {
    branchId: Number(src.branch_id ?? src.branchId) || null,
    channel: normalizeChannel(src.channel),
    from: DAY_RE.test(src.from ?? '') ? bkkDayStart(src.from) : null,
    to: DAY_RE.test(src.to ?? '') ? new Date(bkkDayStart(src.to).getTime() + 86_400_000) : null,
    hasComment: src.has_comment === '1' || src.hasComment === true,
  };
}

/** textKeys = รหัสคำถามแบบข้อความ (ใช้กับตัวกรอง "มีข้อเสนอแนะ") */
function applyResponseFilter(q, f, textKeys = []) {
  if (f.branchId) q.where('r.branch_id', f.branchId);
  if (f.channel) q.where('r.channel', f.channel);
  if (f.from) q.where('r.submitted_at', '>=', f.from);
  if (f.to) q.where('r.submitted_at', '<', f.to);
  if (f.hasComment) q.whereExists(db('answers as c').whereRaw('c.response_id = r.id').whereIn('c.question_key', textKeys.length ? textKeys : ['']).whereNotNull('c.value_text'));
  return q;
}

const textKeysOf = (catalog) => catalog.filter((q) => q.type === 'short_text' || q.type === 'long_text').map((q) => q.key);

/** ชื่อคำถามของทุกเวอร์ชัน เรียงตามเวอร์ชันล่าสุดก่อน แล้วต่อด้วยคำถามที่ถูกลบไปแล้ว — คำตอบเก่าจึงยังมีชื่อแสดง */
async function questionCatalog() {
  const versions = await db('survey_versions').orderBy('id', 'desc').select('questions');
  const catalog = new Map();
  for (const v of versions) {
    for (const q of parseJson(v.questions) ?? []) if (!catalog.has(q.key)) catalog.set(q.key, { key: q.key, label: shortLabel(q), type: q.type, min: q.config?.min ?? 1, max: q.config?.max ?? 5 });
  }
  return [...catalog.values()];
}

adminRouter.get('/responses', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;
  const filter = parseResponseFilter(req.query);
  const catalog = await questionCatalog();

  const base = () => applyResponseFilter(db('responses as r'), filter, textKeysOf(catalog));
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
    questions: catalog,
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

adminRouter.get('/responses/:id', async (req, res) => {
  const id = Number(req.params.id);
  const detail = Number.isInteger(id) && id > 0 ? await responseDetail(id) : null;
  if (!detail) return res.status(404).json({ error: 'not_found' });
  res.json(detail);
});

/**
 * ลบคำตอบ (เช่น ข้อมูลทดสอบ): { ids: [...] } หรือ { all: true, filter: {...} } = ทุกรายการที่ตรงตัวกรอง
 * คำตอบย่อยและคิวส่งชีทถูกลบตาม (cascade) · แถวที่ขึ้นชีทไปแล้วเข้าคิว sheet_deletions ให้ worker ลบออกจากชีท
 */
adminRouter.post('/responses/delete', async (req, res) => {
  const parsed = z
    .union([
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }),
      z.object({ all: z.literal(true), filter: z.record(z.string(), z.unknown()).default({}) }),
    ])
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const textKeys = textKeysOf(await questionCatalog());
  const deleted = await db.transaction(async (trx) => {
    const ids = 'ids' in parsed.data
      ? await trx('responses').whereIn('id', parsed.data.ids).pluck('id')
      : await applyResponseFilter(trx('responses as r'), parseResponseFilter(parsed.data.filter), textKeys).pluck('r.id');
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await trx.raw(`INSERT IGNORE INTO sheet_deletions (response_id) VALUES ${chunk.map(() => '(?)').join(',')}`, chunk);
      await trx('responses').whereIn('id', chunk).del();
    }
    return ids.length;
  });
  clearStatsCache();
  res.json({ ok: true, deleted });
});

// ---------- แจ้งเตือนอีเมล (ส่งจริงจาก Vercel: api/notify-flush.js — Render เข้าคิวอย่างเดียว) ----------
const MAX_RECIPIENTS = 50;

async function notifyPayload() {
  const rows = await db('notify_recipients as n').leftJoin('branches as b', 'b.id', 'n.branch_id').orderBy('n.email').orderBy('n.id').select('n.id', 'n.email', 'n.branch_id', 'b.name as branch');
  return {
    recipients: rows.map((r) => ({ id: r.id, email: r.email, branchId: r.branch_id ?? null, branch: r.branch ?? null })),
    settings: await getNotifySettings(),
    stats: await notifyStats(),
  };
}

adminRouter.get('/notify', async (_req, res) => {
  res.json(await notifyPayload());
});

// เพิ่มผู้รับ: branchIds = [] → ทุกสาขา, [id, …] → เฉพาะสาขาเหล่านั้น (1 แถวต่อสาขา) · ซ้ำของเดิม = ข้าม
adminRouter.post('/notify/recipients', async (req, res) => {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().max(254).email('อีเมลไม่ถูกต้อง'), branchIds: z.array(z.number().int().positive()).max(100).default([]) })
    .safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { email, branchIds } = parsed.data;

  const branches = branchIds.length ? await db('branches').whereIn('id', branchIds).pluck('id') : [];
  if (branches.length !== new Set(branchIds).size) return res.status(404).json({ error: 'branch_not_found' });
  const scopes = branchIds.length ? branches : [null];
  const existing = await db('notify_recipients').whereRaw('LOWER(email) = ?', [email]).pluck('branch_id');
  const fresh = scopes.filter((id) => !existing.includes(id));
  const [{ n }] = await db('notify_recipients').count({ n: '*' });
  if (Number(n) + fresh.length > MAX_RECIPIENTS) return res.status(422).json({ error: 'too_many_recipients', max: MAX_RECIPIENTS });
  if (fresh.length) await db('notify_recipients').insert(fresh.map((branch_id) => ({ email, branch_id })));
  res.status(201).json(await notifyPayload());
});

adminRouter.delete('/notify/recipients/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'not_found' });
  const deleted = await db('notify_recipients').where({ id }).del();
  if (!deleted) return res.status(404).json({ error: 'not_found' });
  res.json(await notifyPayload());
});

adminRouter.put('/notify/settings', async (req, res) => {
  const parsed = z.object({ mode: z.enum(NOTIFY_MODES) }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  await setNotifySettings(parsed.data);
  res.json(await notifyPayload());
});

// อีเมลทดสอบถึงผู้รับทุกคน — เข้าคิวที่นี่ แล้วหน้าเว็บเรียก /api/notify-flush (Vercel) ให้ส่งทันที
adminRouter.post('/notify/test', async (_req, res) => {
  const [{ n }] = await db('notify_recipients').count({ n: '*' });
  if (!Number(n)) return res.status(422).json({ error: 'no_recipients' });
  await db('email_outbox').insert({ kind: 'test' });
  res.status(201).json({ ok: true });
});
