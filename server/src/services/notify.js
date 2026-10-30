import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { parseJson } from './links.js';
import { responseDetail } from './responses.js';

// แจ้งเตือนอีเมลรีวิวใหม่
// - submitForm เข้าคิว email_outbox ใน transaction เดียวกับคำตอบ (queueResponseEmail) → ไม่มีรีวิวไหนตกหล่น
// - flushEmails ส่งจริงผ่าน Resend (HTTPS API): Vercel เรียกหลังตอบลูกค้าแล้ว (waitUntil) + api/notify-flush (GitHub ปลุกทุก 30 นาที)
//   เปิด EMAIL_ENABLED ที่ Vercel ที่เดียว — Render ทำแค่จัดการผู้รับ/เข้าคิว
// - กันส่งซ้ำเมื่อหลาย instance ล้างคิวพร้อมกัน: จองแถวด้วย claim_id ก่อนส่ง (จองค้างเกิน 5 นาที = ปล่อยให้คนอื่นส่งต่อ)

const MAX_ATTEMPTS = 8;
const CLAIM_TTL_MS = 5 * 60 * 1000;
export const NOTIFY_MODES = ['all', 'important'];
const DEFAULT_SETTINGS = { mode: 'all' };
const CHANNEL_TEXT = { store: 'หน้าร้าน', online: 'ออนไลน์' };
// เวลาไทย YYYY-MM-DD HH:mm (ไม่ import จาก sheetsSync.js — ไฟล์นี้ใช้บน Vercel ซึ่งไม่ได้ติดตั้ง @googleapis/sheets)
const bangkokTime = (date) => new Date(new Date(date).getTime() + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

// ---------- ค่าตั้ง ----------
export async function getNotifySettings(database = db) {
  const row = await database('app_settings').where({ key: 'notify' }).first();
  return { ...DEFAULT_SETTINGS, ...(parseJson(row?.value) ?? {}) };
}

export async function setNotifySettings(patch, database = db) {
  const value = JSON.stringify({ ...(await getNotifySettings(database)), ...patch });
  await database('app_settings').insert({ key: 'notify', value }).onConflict('key').merge({ value, updated_at: database.fn.now(3) });
}

/** ผู้รับของรีวิวสาขานี้ = ผู้รับของสาขา + ผู้รับ "ทุกสาขา" (ไม่ซ้ำ ไม่สนตัวพิมพ์) */
export async function recipientsFor(branchId, database = db) {
  const rows = await database('notify_recipients')
    .where((q) => {
      q.whereNull('branch_id');
      if (branchId) q.orWhere('branch_id', branchId);
    })
    .orderBy('id')
    .pluck('email');
  return uniqueEmails(rows);
}

const uniqueEmails = (list) => [...new Map(list.map((e) => [e.toLowerCase(), e])).values()];

// ตาราง email_outbox ถูกสร้างโดย migration ตอน Render deploy — แต่ Vercel อาจขึ้นก่อน
// ตรวจก่อนเข้าคิว (จำไว้เมื่อพบแล้ว) เพื่อให้การบันทึกคำตอบลูกค้าไม่ล้มเพราะตารางยังไม่มี
let outboxReady = false;
async function hasOutbox(trx) {
  if (!outboxReady) {
    const [rows] = await trx.raw("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'email_outbox' LIMIT 1");
    outboxReady = rows.length > 0;
  }
  return outboxReady;
}

export async function queueResponseEmail(trx, responseId) {
  if (await hasOutbox(trx)) await trx('email_outbox').insert({ response_id: responseId, kind: 'response' });
}

// ---------- เนื้อหาอีเมล ----------
const ratingItems = (detail) => detail.items.filter((it) => it.type === 'rating' && it.value != null);
const toFive = (it) => (Number(it.value) / (it.max || 5)) * 5;

/** คะแนนเฉลี่ย (เทียบเต็ม 5) ของรีวิวนี้ */
export function averageScore(detail) {
  const list = ratingItems(detail);
  return list.length ? Math.round((list.reduce((a, it) => a + toFive(it), 0) / list.length) * 10) / 10 : null;
}

/** คะแนนต่ำ = มีข้อที่ได้ ≤ 2 (เต็ม 5) หรือเฉลี่ยต่ำกว่า 3 */
export function isLowScore(detail) {
  const avg = averageScore(detail);
  return ratingItems(detail).some((it) => toFive(it) <= 2) || (avg != null && avg < 3);
}

const hasComment = (detail) => detail.items.some((it) => (it.type === 'long_text' || it.type === 'short_text') && String(it.value ?? '').trim());

/** โหมด "เฉพาะที่สำคัญ": คะแนนต่ำ หรือมีข้อเสนอแนะ */
export const isImportant = (detail) => isLowScore(detail) || hasComment(detail);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SCORE_COLORS = ['#c62828', '#ef7d22', '#e0a800', '#7cb342', '#2e7d32']; // 1 → 5 (เดียวกับ Dashboard) · ตัวอักษร: 1/5 ขาว, 2–4 เข้ม ให้อ่านง่าย

function answerText(it) {
  if (it.value == null || it.value === '') return '–';
  if (it.type === 'rating') return `${it.value}/${it.max || 5}`;
  return Array.isArray(it.value) ? it.value.join(', ') : String(it.value);
}

/** อีเมล 1 ฉบับต่อรีวิว — ข้อความลูกค้า escape ทุกจุด */
export function buildEmail(detail, { baseUrl = config.PUBLIC_BASE_URL } = {}) {
  const avg = averageScore(detail);
  const channel = CHANNEL_TEXT[detail.channel] ?? detail.channel ?? '';
  const when = `${bangkokTime(detail.submittedAt)} น.`;
  const subject = `${isLowScore(detail) ? '⚠️ ' : ''}[รีวิวใหม่] ${[detail.branch ?? 'ไม่ระบุสาขา', channel, avg != null ? `เฉลี่ย ${avg}/5` : null].filter(Boolean).join(' · ')}`;
  const link = `${baseUrl}/admin/#/responses`;

  const text = [
    `รีวิวใหม่ #${detail.id}`,
    `สาขา: ${detail.branch ?? '-'} · ช่องทาง: ${channel} · เวลา: ${when}`,
    '',
    ...detail.items.map((it) => `${it.label}: ${answerText(it)}`),
    '',
    `ดูคำตอบทั้งหมด: ${link}`,
    'ตั้งค่าผู้รับได้ที่หน้าแอดมิน → แจ้งเตือนอีเมล',
  ].join('\n');

  const row = (it) => {
    let value;
    if (it.type === 'rating' && it.value != null) {
      const level = Math.min(5, Math.max(1, Math.round(toFive(it))));
      value = `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${SCORE_COLORS[level - 1]};color:${level === 1 || level === 5 ? '#fff' : '#1b1f1c'};font-weight:600">${escapeHtml(answerText(it))}</span>`;
    } else if (it.type === 'long_text' || it.type === 'short_text') {
      value = it.value ? `<div style="white-space:pre-wrap;background:#f3f6f3;border-left:3px solid #2e8b43;padding:8px 12px;border-radius:0 8px 8px 0">${escapeHtml(it.value)}</div>` : '–';
    } else {
      value = escapeHtml(answerText(it));
    }
    return `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #e6ebe6;vertical-align:top;color:#4b5a50">${escapeHtml(it.label)}</td><td style="padding:8px 0;border-bottom:1px solid #e6ebe6">${value}</td></tr>`;
  };

  const html = `<div style="font-family:Tahoma,'Noto Sans Thai',Arial,sans-serif;max-width:560px;color:#1b1f1c;font-size:15px;line-height:1.6">
<h2 style="margin:0 0 4px;color:#15673a;font-size:20px">รีวิวใหม่ #${escapeHtml(detail.id)}${avg != null ? ` · เฉลี่ย ${escapeHtml(avg)}/5` : ''}</h2>
<p style="margin:0 0 16px;color:#4b5a50">${escapeHtml(detail.branch ?? 'ไม่ระบุสาขา')} · ${escapeHtml(channel)} · ${escapeHtml(when)}</p>
<table style="border-collapse:collapse;width:100%">${detail.items.map(row).join('')}</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#15673a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px">ดูคำตอบในหน้าแอดมิน</a></p>
<p style="margin:16px 0 0;color:#7a857d;font-size:12px">ตั้งค่าผู้รับได้ที่หน้าแอดมิน → แจ้งเตือนอีเมล</p>
</div>`;
  return { subject, text, html };
}

function buildTestEmail({ baseUrl = config.PUBLIC_BASE_URL } = {}) {
  const text = `อีเมลทดสอบจากระบบรีวิวเหนียวหมูไส้แตก\nถ้าได้รับอีเมลนี้ แปลว่าการแจ้งเตือนอีเมลใช้งานได้แล้ว\nตั้งค่าผู้รับ: ${baseUrl}/admin/#/notify`;
  const html = `<div style="font-family:Tahoma,'Noto Sans Thai',Arial,sans-serif;font-size:15px;line-height:1.6"><h2 style="color:#15673a;margin:0 0 8px">ทดสอบการแจ้งเตือนอีเมล ✅</h2><p>ถ้าได้รับอีเมลนี้ แปลว่าการแจ้งเตือนรีวิวใหม่ใช้งานได้แล้ว</p><p style="color:#7a857d;font-size:12px">ตั้งค่าผู้รับ: <a href="${escapeHtml(baseUrl)}/admin/#/notify">หน้าแอดมิน → แจ้งเตือนอีเมล</a></p></div>`;
  return { subject: 'ทดสอบการแจ้งเตือนอีเมล — รีวิวเหนียวหมูไส้แตก', text, html };
}

// ---------- ส่ง ----------
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_GAP_MS = 600; // Resend จำกัดประมาณ 2 คำขอ/วินาที

/**
 * Resend API — ส่งผ่าน HTTPS (ไม่ใช้พอร์ตอีเมล) · idempotencyKey = คิวแถวเดิมส่งซ้ำไม่ได้ (เช่น ส่งสำเร็จแต่คำตอบหลุด แล้วลองใหม่)
 * ผิดพลาด throw พร้อมข้อความจาก Resend (เช่น โดเมนยังไม่ยืนยัน) ให้ไปแสดงในหน้าแอดมิน
 */
const resendTransport = {
  async send({ to, subject, text, html, idempotencyKey }) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, text, html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`Resend ${res.status}: ${body?.message ?? res.statusText}`);
    }
  },
};

/** สำหรับเทสต์ */
export const _resendTransport = resendTransport;

/** ส่งได้จริงที่เครื่องนี้ไหม (เปิด + มี key) */
const canSend = () => config.EMAIL_ENABLED && Boolean(config.RESEND_API_KEY);

/**
 * ส่งอีเมลที่ค้างในคิว (สูงสุด limit ฉบับ) · transport = { send({ to, subject, text, html }) } (เทสต์ส่งของปลอมเข้ามา)
 * ไม่ throw — ผิดพลาดเก็บใน last_error แล้วลองใหม่รอบหน้า
 */
export async function flushEmails({ limit = 20, transport, database = db } = {}) {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!transport && !canSend()) return { ...result, disabled: true }; // ไม่แตะคิว — อีเมลรอจนกว่าจะตั้งค่าครบ

  const claimId = randomBytes(8).toString('hex');
  const free = (q) => q.whereNull('sent_at').whereNull('failed_at').where((w) => w.whereNull('claimed_at').orWhere('claimed_at', '<', new Date(Date.now() - CLAIM_TTL_MS)));
  const ids = await database('email_outbox').modify(free).orderBy('id').limit(limit).pluck('id');
  if (!ids.length) return result;
  await database('email_outbox').whereIn('id', ids).modify(free).update({ claim_id: claimId, claimed_at: new Date() });
  const rows = await database('email_outbox').where({ claim_id: claimId }).whereNull('sent_at').orderBy('id');

  const settings = await getNotifySettings(database);
  const done = (row, patch) => database('email_outbox').where({ id: row.id }).update({ sent_at: new Date(), claim_id: null, ...patch });

  let sentBefore = false;
  for (const row of rows) {
    try {
      let to;
      let message;
      if (row.kind === 'test') {
        to = row.to_email ? [row.to_email] : uniqueEmails(await database('notify_recipients').orderBy('id').pluck('email'));
        message = buildTestEmail();
      } else {
        const detail = await responseDetail(row.response_id);
        const branchId = (await database('responses').where({ id: row.response_id }).first('branch_id'))?.branch_id ?? null;
        if (!detail || (settings.mode === 'important' && !isImportant(detail))) {
          await done(row, { skipped: true });
          result.skipped++;
          continue;
        }
        to = await recipientsFor(branchId, database);
        message = buildEmail(detail);
      }
      if (!to.length) {
        await done(row, { skipped: true });
        result.skipped++;
        continue;
      }
      if (sentBefore && !transport) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
      sentBefore = true;
      await (transport ?? resendTransport).send({ to, ...message, idempotencyKey: `email-outbox-${row.id}` });
      await done(row, { recipients: to.length, last_error: null });
      result.sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await database('email_outbox')
        .where({ id: row.id })
        .update({ attempts, last_error: String(err?.message ?? err).slice(0, 500), claim_id: null, claimed_at: null, failed_at: attempts >= MAX_ATTEMPTS ? new Date() : null });
      console.error(`Email notify: ส่งไม่สำเร็จ (คิว #${row.id} ครั้งที่ ${attempts}):`, err?.message ?? err);
      result.failed++;
    }
  }
  return result;
}

/** สถานะสำหรับหน้าแอดมิน: ส่งวันนี้ (นับต่อผู้รับ เทียบโควตา Resend), ค้าง, ล้มเหลว 7 วัน + error ล่าสุด */
export async function notifyStats(database = db) {
  const now = Date.now();
  const bangkokMidnight = new Date(Math.floor((now + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000);
  const [today] = await database('email_outbox').where('sent_at', '>=', bangkokMidnight).sum({ n: 'recipients' });
  const [pending] = await database('email_outbox').whereNull('sent_at').whereNull('failed_at').count({ n: '*' });
  const [failed] = await database('email_outbox').whereNotNull('failed_at').where('failed_at', '>=', new Date(now - 7 * 86_400_000)).count({ n: '*' });
  const lastError = await database('email_outbox').whereNotNull('last_error').whereNull('sent_at').orderBy('id', 'desc').first('last_error', 'attempts', 'created_at');
  return {
    sentToday: Number(today?.n ?? 0),
    pending: Number(pending?.n ?? 0),
    failed: Number(failed?.n ?? 0),
    lastError: lastError ? { message: lastError.last_error, attempts: lastError.attempts, at: new Date(lastError.created_at).toISOString() } : null,
    enabledHere: canSend(),
  };
}
