// ฟังก์ชันล้วน (ไม่แตะเครือข่าย/ไฟล์) สำหรับสคริปต์ตั้งค่า Google Sheets — แยกไว้เพื่อทดสอบได้ง่าย

/** รับ Sheet ID หรือ URL เต็มของชีท แล้วคืน Sheet ID (หรือ null ถ้ารูปแบบไม่ถูก) */
export function parseSheetId(input) {
  const text = String(input ?? '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}

/** ตรวจว่าเป็นไฟล์ key ของ Service Account จริง คืน { credentials, b64, email } หรือโยน Error ภาษาไทย */
export function parseServiceAccountKey(jsonText) {
  let credentials;
  try {
    credentials = JSON.parse(jsonText);
  } catch {
    throw new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง — ต้องเป็นไฟล์ key ที่ดาวน์โหลดจาก Google Cloud (Keys → Add key → JSON)');
  }
  if (credentials?.type !== 'service_account') throw new Error('ไฟล์นี้ไม่ใช่ key ของ Service Account (ไม่มี "type": "service_account")');
  if (!credentials.client_email || !String(credentials.private_key ?? '').includes('BEGIN PRIVATE KEY')) {
    throw new Error('ไฟล์ key ไม่สมบูรณ์ (ขาด client_email หรือ private_key)');
  }
  return { credentials, email: credentials.client_email, b64: Buffer.from(JSON.stringify(credentials), 'utf8').toString('base64') };
}

/** อัปเดต/เพิ่มค่าในข้อความไฟล์ .env โดยไม่แตะบรรทัดอื่น (ค่าใหม่แทนที่บรรทัดเดิมที่ชื่อตรงกัน) */
export function upsertEnv(text, updates) {
  const lines = text.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const value = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${value}`;
    }
    return line;
  });
  while (out.length && out.at(-1) === '') out.pop();
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  return `${out.join('\n')}\n`;
}

/** แปลง error ของ Google API เป็นคำแนะนำภาษาไทยที่ทำตามได้ทันที */
export function explainGoogleError(err, { email, sheetId } = {}) {
  const status = err?.status ?? err?.code ?? err?.response?.status;
  const text = `${err?.message ?? ''} ${JSON.stringify(err?.response?.data ?? '')}`;
  const who = email ? ` (${email})` : '';

  if (/SERVICE_DISABLED|has not been used in project|Google Sheets API.*disabled/i.test(text)) {
    return 'ยังไม่ได้เปิด Google Sheets API ในโปรเจกต์ → เปิดที่ https://console.cloud.google.com/apis/library/sheets.googleapis.com แล้วกด Enable (รอ 1–2 นาที)';
  }
  if (/invalid_grant|invalid jwt|DECODER|unauthorized_client|invalid_client|private key/i.test(text)) {
    return 'key ของ Service Account ใช้ไม่ได้ (ถูกลบ/หมดอายุ/คัดลอกมาไม่ครบ หรือเวลาเครื่องคลาดเคลื่อน) → สร้าง key ใหม่ที่ IAM → Service Accounts → Keys แล้วรัน npm run sheets:setup ใหม่';
  }
  if (String(status) === '403' || /permission|forbidden/i.test(text)) {
    return `ไม่มีสิทธิ์เข้าชีท → เปิดชีท กด Share แล้วเพิ่มอีเมล${who} เป็น Editor (ไม่ต้องส่งอีเมลแจ้ง)`;
  }
  if (String(status) === '404' || /not found/i.test(text)) {
    return `ไม่พบชีท${sheetId ? ` (ID ${sheetId.slice(0, 8)}…)` : ''} → ตรวจ GOOGLE_SHEET_ID ว่าคัดลอกจาก URL ถูกส่วน (ข้อความยาวระหว่าง /d/ กับ /edit) และชีทไม่ได้ถูกลบ`;
  }
  if (String(status) === '429' || /quota|rate limit/i.test(text)) {
    return 'เกินโควตาของ Google Sheets (เขียนได้ 60 ครั้ง/นาที) → รอสักครู่แล้วลองใหม่; ระบบซิงก์จะลองส่งซ้ำเองอยู่แล้ว';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(text)) {
    return 'เชื่อมต่ออินเทอร์เน็ต/Google ไม่ได้ → ตรวจเครือข่ายหรือพร็อกซีแล้วลองใหม่';
  }
  return null;
}
