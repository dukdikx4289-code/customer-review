// ตั้งค่า Google Sheets ในเครื่องให้ในคำสั่งเดียว (ไม่พิมพ์ key ออกหน้าจอ):
//   npm run sheets:setup -- --key "D:\ที่เก็บ\my-key.json" --sheet "https://docs.google.com/spreadsheets/d/<ID>/edit"
//
// ทำอะไร: ตรวจไฟล์ key → แปลงเป็น base64 → เขียน GOOGLE_SERVICE_ACCOUNT_JSON_B64 / GOOGLE_SHEET_ID / SHEETS_SYNC_ENABLED ลง server/.env
//         → รัน sheets:check ให้ทันที | ตัวเลือก: --copy คัดลอก base64 ไปคลิปบอร์ด (ไว้วางใน Render), --no-enable ไม่เปิดซิงก์
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceAccountKey, parseSheetId, upsertEnv } from '../src/services/sheetsSetup.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(serverDir, '..');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const keyPath = opt('key');
const sheetId = parseSheetId(opt('sheet'));
if (!keyPath || !opt('sheet')) {
  fail('ต้องระบุทั้ง --key <ไฟล์ key.json> และ --sheet <URL หรือ ID ของชีท>\nตัวอย่าง: npm run sheets:setup -- --key "D:\\keys\\review-key.json" --sheet "https://docs.google.com/spreadsheets/d/xxxxxxxx/edit"');
}
if (!sheetId) fail('อ่าน Sheet ID จากค่าที่ให้มาไม่ได้ — ใช้ URL เต็มของชีท หรือข้อความยาวระหว่าง /d/ กับ /edit');

const resolved = path.resolve(keyPath);
if (!fs.existsSync(resolved)) fail(`ไม่พบไฟล์: ${resolved}`);

// กันเผลอวางไฟล์ key ไว้ในโฟลเดอร์โปรเจกต์ (repo นี้เป็น public — key หลุดคือชีทถูกยึดได้)
const rel = path.relative(repoDir, resolved);
const inRepo = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); // ต่างไดรฟ์ (Windows) = relative เป็น path เต็ม → ไม่ใช่ในโปรเจกต์
if (inRepo && !flag('allow-in-repo')) {
  fail(`ไฟล์ key อยู่ในโฟลเดอร์โปรเจกต์ (${resolved}) เสี่ยง commit หลุดขึ้น GitHub สาธารณะ\n  → ย้ายไปไว้นอกโฟลเดอร์โปรเจกต์ (เช่น Documents) แล้วรันใหม่ (หรือใส่ --allow-in-repo ถ้ามั่นใจว่าถูก .gitignore)`);
}

let parsed;
try {
  parsed = parseServiceAccountKey(fs.readFileSync(resolved, 'utf8'));
} catch (err) {
  fail(err.message);
}

const envPath = path.resolve(opt('env') ?? path.join(serverDir, '.env'));
const before = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const updates = {
  GOOGLE_SHEET_ID: sheetId,
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: parsed.b64,
  ...(flag('no-enable') ? {} : { SHEETS_SYNC_ENABLED: 'true' }),
};
fs.writeFileSync(envPath, upsertEnv(before, updates));

console.log(`✔ บันทึกค่าลง ${envPath}`);
console.log(`  Service Account: ${parsed.email}`);
console.log(`  Sheet ID:        ${sheetId}`);
console.log(`  ซิงก์:           ${flag('no-enable') ? 'ยังไม่เปิด (SHEETS_SYNC_ENABLED ไม่ถูกแก้)' : 'เปิดแล้ว (SHEETS_SYNC_ENABLED=true)'}`);

if (flag('copy')) {
  if (process.platform === 'win32') {
    const r = spawnSync('clip', { input: parsed.b64 });
    console.log(r.status === 0 ? '✔ คัดลอกค่า GOOGLE_SERVICE_ACCOUNT_JSON_B64 ไปคลิปบอร์ดแล้ว (วางใน Render → Environment)' : '✖ คัดลอกไปคลิปบอร์ดไม่สำเร็จ — เปิดไฟล์ .env แล้วคัดลอกค่าเอง');
  } else {
    console.log('ℹ --copy รองรับเฉพาะ Windows — เปิดไฟล์ .env แล้วคัดลอกค่า GOOGLE_SERVICE_ACCOUNT_JSON_B64 เอง');
  }
}

console.log('\n→ ตรวจการเชื่อมต่อ…\n');
try {
  execFileSync(process.execPath, [path.join(serverDir, 'scripts', 'sheets-check.js'), '--env', envPath], { stdio: 'inherit' });
} catch {
  process.exit(1);
}
console.log('\nเสร็จแล้ว — ควรเก็บไฟล์ key ไว้ในที่ปลอดภัย (password manager) แล้วลบสำเนาที่ไม่ใช้ออก; ห้ามส่งทาง LINE/อีเมล หรือ commit');
