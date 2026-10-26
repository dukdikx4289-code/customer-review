import { db } from '../db/knex.js';
import { resolveLink, getLatestVersion } from './links.js';
import { validateAnswers, questionsForChannel, normalizeChannel, CHANNELS } from './questions.js';

// ฟอร์มลูกค้า (เปิดจาก QR) — ใช้ร่วมกันทั้ง Express บน Render (routes/public.js)
// และ Vercel Functions (api/r/…) ที่ทำให้ลูกค้าไม่ต้องรอ Render ตื่น
// คืน { status, body } เสมอ ให้แต่ละที่แปลงเป็น HTTP response เอง

const NOT_FOUND = { status: 404, body: { error: 'not_found' } };

async function loadContext(token) {
  const link = await resolveLink(token, 'customer');
  if (!link) return null;

  const branch = link.branch_id ? await db('branches').where({ id: link.branch_id }).first() : null;
  if (link.branch_id && (!branch || !branch.is_active)) return null;

  const survey = await db('surveys').where({ id: link.survey_id }).first();
  if (!survey || survey.status !== 'active') return null;

  const version = await getLatestVersion(survey.id, { branchId: link.branch_id });
  if (!version) return null;

  // ลิงก์ผูกช่องทาง (หน้าร้าน/ออนไลน์) หรือ 'choose' = QR เดียว ลูกค้าเลือกช่องทางเองตอนสแกน
  const choose = link.channel === 'choose';
  const fixed = choose ? null : normalizeChannel(link.channel) ?? 'store';
  const questionsOf = (channel) => questionsForChannel(version.questions, channel);
  return { link, branch, survey, version, choose, fixed, questionsOf };
}

const publicQuestions = (list) => list.map(({ channels, ...q }) => q);

/** ข้อมูลที่ฟอร์มลูกค้าต้องใช้ — ไม่ส่ง id ภายในออกไป */
export async function loadForm(token) {
  const ctx = await loadContext(token);
  if (!ctx) return NOT_FOUND;

  const base = { survey: { title: ctx.survey.title }, branch: ctx.branch ? { name: ctx.branch.name } : null, settings: ctx.version.settings };
  if (ctx.choose) {
    // questions/channel = ชุดหน้าร้าน เผื่อหน้าเว็บเวอร์ชันเก่าที่ยังไม่รู้จักหน้าเลือก (ระหว่าง deploy)
    return {
      status: 200,
      body: {
        ...base,
        channel: 'store',
        channelChoice: true,
        questions: publicQuestions(ctx.questionsOf('store')),
        questionsByChannel: Object.fromEntries(CHANNELS.map((c) => [c, publicQuestions(ctx.questionsOf(c))])),
      },
    };
  }
  return { status: 200, body: { ...base, channel: ctx.fixed, questions: publicQuestions(ctx.questionsOf(ctx.fixed)) } };
}

/**
 * บันทึกคำตอบ · headers = { userAgent, language }
 * ไม่เก็บ IP ลูกค้า (ลดภาระ PDPA) เก็บเฉพาะ user-agent และภาษา
 */
export async function submitForm(token, rawBody, { userAgent = '', language = '' } = {}) {
  const ctx = await loadContext(token);
  if (!ctx) return NOT_FOUND;

  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {};

  // honeypot: ช่องที่คนจริงมองไม่เห็น ถ้ามีค่า = บอท — ตอบสำเร็จหลอกๆ โดยไม่บันทึก
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return { status: 201, body: { ok: true } };
  }

  // QR แบบเลือกเอง: ใช้ช่องทางที่ลูกค้าเลือก (ไม่ส่งมา = หน้าร้าน รองรับหน้าเว็บเก่า) · ลิงก์ผูกช่องทาง: ใช้ของลิงก์เสมอ
  const channel = ctx.choose ? normalizeChannel(body.channel) ?? 'store' : ctx.fixed;
  const result = validateAnswers(ctx.questionsOf(channel), body.answers);
  if (!result.ok) return { status: 422, body: { error: 'invalid_answers', fields: result.errors } };
  if (result.rows.length === 0) return { status: 422, body: { error: 'empty_submission' } };

  const meta = { ua: String(userAgent ?? '').slice(0, 200), lang: String(language ?? '').slice(0, 20) };

  await db.transaction(async (trx) => {
    const [responseId] = await trx('responses').insert({
      survey_id: ctx.survey.id,
      version_id: ctx.version.id,
      branch_id: ctx.branch?.id ?? null,
      link_id: ctx.link.id,
      channel,
      meta: JSON.stringify(meta),
    });
    await trx('answers').insert(result.rows.map((row) => ({ response_id: responseId, ...row })));
    await trx('sheet_outbox').insert({ response_id: responseId });
  });

  return { status: 201, body: { ok: true, thankYou: ctx.version.settings.thankYou ?? null } };
}
