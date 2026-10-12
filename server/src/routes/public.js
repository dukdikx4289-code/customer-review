import { Router } from 'express';
import { db } from '../db/knex.js';
import { resolveLink, getLatestVersion } from '../services/links.js';
import { validateAnswers } from '../services/questions.js';
import { badTokenLimiter, submitLimiter } from '../middleware/rateLimit.js';

export const publicRouter = Router();

const notFound = (res) => res.status(404).json({ error: 'not_found' });

async function loadContext(token) {
  const link = await resolveLink(token, 'customer');
  if (!link) return null;

  const branch = link.branch_id ? await db('branches').where({ id: link.branch_id }).first() : null;
  if (link.branch_id && (!branch || !branch.is_active)) return null;

  const survey = await db('surveys').where({ id: link.survey_id }).first();
  if (!survey || survey.status !== 'active') return null;

  const version = await getLatestVersion(survey.id);
  if (!version) return null;

  return { link, branch, survey, version };
}

// ข้อมูลที่ฟอร์มลูกค้าต้องใช้ — ไม่ส่ง id ภายในออกไป
publicRouter.get('/r/:token', badTokenLimiter, async (req, res) => {
  const ctx = await loadContext(req.params.token);
  if (!ctx) return notFound(res);

  res.json({
    survey: { title: ctx.survey.title },
    branch: ctx.branch ? { name: ctx.branch.name } : null,
    questions: ctx.version.questions,
    settings: ctx.version.settings,
  });
});

publicRouter.post('/r/:token/submit', badTokenLimiter, submitLimiter, async (req, res) => {
  const ctx = await loadContext(req.params.token);
  if (!ctx) return notFound(res);

  const body = req.body ?? {};

  // honeypot: ช่องที่คนจริงมองไม่เห็น ถ้ามีค่า = บอท — ตอบสำเร็จหลอกๆ โดยไม่บันทึก
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return res.status(201).json({ ok: true });
  }

  const result = validateAnswers(ctx.version.questions, body.answers);
  if (!result.ok) return res.status(422).json({ error: 'invalid_answers', fields: result.errors });
  if (result.rows.length === 0) return res.status(422).json({ error: 'empty_submission' });

  // ไม่เก็บ IP ลูกค้า (ลดภาระ PDPA) เก็บเฉพาะ user-agent และภาษา
  const meta = {
    ua: String(req.get('user-agent') ?? '').slice(0, 200),
    lang: String(req.get('accept-language') ?? '').slice(0, 20),
  };

  await db.transaction(async (trx) => {
    const [responseId] = await trx('responses').insert({
      survey_id: ctx.survey.id,
      version_id: ctx.version.id,
      branch_id: ctx.branch?.id ?? null,
      link_id: ctx.link.id,
      meta: JSON.stringify(meta),
    });
    await trx('answers').insert(result.rows.map((row) => ({ response_id: responseId, ...row })));
    await trx('sheet_outbox').insert({ response_id: responseId });
  });

  res.status(201).json({ ok: true, thankYou: ctx.version.settings.thankYou ?? null });
});
