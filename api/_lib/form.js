// Vercel Functions ของฟอร์มลูกค้า: GET /api/r/:token และ POST /api/r/:token/submit
// (vercel.json rewrite ไป api/form-load.js / api/form-submit.js พร้อม ?token= — ต้องอยู่ก่อน rewrite /api/:path* ที่ไป Render)
// ทำให้ลูกค้าที่สแกน QR ไม่ต้องรอ Render (แพ็กเกจฟรีหลับเมื่อว่าง 15 นาที) — /api อื่นยัง rewrite ไป Render (vercel.json)
// ตรรกะเดียวกับ Render ทุกอย่าง (server/src/services/publicForm.js) · ไฟล์ใน api/_lib ไม่ถูกสร้างเป็น function
import { loadForm, submitForm } from '../../server/src/services/publicForm.js';
import { flushEmails } from '../../server/src/services/notify.js';

// waitUntil = ทำงานต่อหลังตอบลูกค้าแล้ว (ส่งอีเมลแจ้งเตือน) · ในเครื่อง/เทสต์ไม่มี @vercel/functions → รอให้จบในตัว
const { waitUntil } = await import('@vercel/functions').catch(() => ({ waitUntil: (promise) => promise }));

/** ส่งอีเมลที่ค้างในคิวเบื้องหลัง — ไม่ทำให้คำขอล้ม (EMAIL_ENABLED=false = ไม่ทำอะไร) */
export const flushInBackground = () => waitUntil(flushEmails().catch((err) => console.error('Email notify:', err?.message ?? err)));

const WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
// เหมือน middleware/rateLimit.js แต่นับต่อ instance (Vercel เปิดหลาย instance ได้ จึงกันได้หยาบกว่า — honeypot ยังทำงานเหมือนเดิม)
const LIMITS = { badToken: 30, submit: 60 };
const buckets = new Map(); // `${kind}:${ip}` -> { count, reset }

function bucket(kind, ip, now = Date.now()) {
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  const key = `${kind}:${ip}`;
  let b = buckets.get(key);
  if (!b || b.reset <= now) buckets.set(key, (b = { count: 0, reset: now + WINDOW_MS }));
  return b;
}

const clientIp = (req) => String(req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';

// connection ที่ค้างตอน instance ถูกพักอาจถูก TiDB ตัดไปแล้ว — ลองใหม่ 1 ครั้ง (ล้มก่อน commit จึงไม่บันทึกซ้ำ)
const CONNECTION_LOST = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
const isConnectionLost = (err) => CONNECTION_LOST.has(err?.code) || /Connection lost|closed state/i.test(err?.message ?? '');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** สร้าง handler: action = 'load' (GET) | 'submit' (POST) */
export function formHandler(action) {
  const method = action === 'submit' ? 'POST' : 'GET';
  return async function handler(req, res) {
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return send(res, 405, { error: 'method_not_allowed' });
    }
    const ip = clientIp(req);
    if (bucket('badToken', ip).count >= LIMITS.badToken) return send(res, 429, { error: 'rate_limited' });

    const token = String(req.query?.token ?? '');
    let run;
    if (action === 'submit') {
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return send(res, 413, { error: 'payload_too_large' });
      if (++bucket('submit', ip).count > LIMITS.submit) return send(res, 429, { error: 'rate_limited' });
      let body;
      try {
        body = req.body; // Vercel แปลง JSON ให้ — JSON เสียจะ throw
      } catch {
        return send(res, 400, { error: 'invalid_json' });
      }
      const headers = { userAgent: req.headers['user-agent'], language: req.headers['accept-language'] };
      run = () => submitForm(token, body, headers);
    } else {
      run = () => loadForm(token);
    }

    try {
      let result;
      try {
        result = await run();
      } catch (err) {
        if (!isConnectionLost(err)) throw err;
        result = await run();
      }
      if (result.status === 404) bucket('badToken', ip).count++;
      send(res, result.status, result.body);
      if (action === 'submit' && result.status === 201) flushInBackground();
    } catch (err) {
      console.error(`${method} /api/r/${token.slice(0, 12)}.***${action === 'submit' ? '/submit' : ''}`, err);
      send(res, 500, { error: 'internal_error' });
    }
  };
}

/** สำหรับเทสต์ */
export const _resetLimits = () => buckets.clear();
