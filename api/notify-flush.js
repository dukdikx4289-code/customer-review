// POST /api/notify-flush — ส่งอีเมลแจ้งเตือนที่ค้างในคิว (สูงสุด 20 ฉบับต่อครั้ง)
// เรียกโดย: หน้าแอดมิน (หลังกด "ส่งอีเมลทดสอบ") และ GitHub workflow wake-render ทุก 30 นาที (ลองส่งที่ค้างใหม่)
// ไม่ต้องล็อกอิน: ส่งได้เฉพาะอีเมลที่ระบบเข้าคิวไว้แล้วถึงผู้รับที่แอดมินตั้ง — ใครเรียกก็ไม่ได้ข้อมูลและสร้างอีเมลใหม่ไม่ได้
import { flushEmails } from '../server/src/services/notify.js';

let last = 0;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }
  // กันถูกเรียกรัวๆ (ต่อ instance): เว้นอย่างน้อย 3 วินาที
  if (Date.now() - last < 3000) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'rate_limited' }));
  }
  last = Date.now();
  try {
    const result = await flushEmails();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error('POST /api/notify-flush', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}
