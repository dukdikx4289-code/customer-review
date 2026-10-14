// ตรวจการเชื่อมต่อ Google Sheets:   npm run sheets:check            (ตรวจอย่างเดียว)
//                                  npm run sheets:check -- --init  (สร้างแท็บ "responses" + หัวตารางที่จัดรูปแบบแล้ว)
//
// ตรวจ: ตั้งค่าครบ → ล็อกอินด้วย key → เห็นชีท → เขียน/อ่าน/ลบได้ (ใช้แท็บชั่วคราว _check) → สถานะหัวตาราง → จำนวนแถวที่ค้างรอส่ง
import fs from 'node:fs';
import dotenv from 'dotenv';

// ให้ --env <ไฟล์> ชนะค่าใน environment ปัจจุบัน (ต้องโหลดก่อน import config)
const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
if (envFlag >= 0 && fs.existsSync(args[envFlag + 1])) dotenv.config({ path: args[envFlag + 1], override: true, quiet: true });

const { config } = await import('../src/config.js');
const { createGoogleClient, mergeHeader, allQuestionKeys } = await import('../src/services/sheetsSync.js');
const { explainGoogleError } = await import('../src/services/sheetsSetup.js');
const { db } = await import('../src/db/knex.js');

const ok = (msg) => console.log(`✔ ${msg}`);
const bad = (msg) => console.log(`✖ ${msg}`);
let exitCode = 0;

try {
  if (!config.GOOGLE_SHEET_ID || !config.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    bad('ยังไม่ได้ตั้ง GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_JSON_B64 → รัน: npm run sheets:setup -- --key <ไฟล์ key.json> --sheet <URL ชีท>  (ดู docs/google-sheets.md)');
    exitCode = 1;
  } else {
    let client;
    try {
      client = createGoogleClient();
    } catch {
      bad('อ่านค่า GOOGLE_SERVICE_ACCOUNT_JSON_B64 ไม่ได้ (ไม่ใช่ base64 ของไฟล์ key) → รัน npm run sheets:setup ใหม่');
      throw Object.assign(new Error('bad key'), { handled: true });
    }
    ok(`ตั้งค่าครบ — Service Account: ${client.email}`);

    try {
      const info = await client.info();
      ok(`เข้าถึงชีทได้: "${info.title}" (แท็บ: ${info.tabs.join(', ') || '–'})`);

      if (await client.selfTest()) ok('ทดสอบเขียน/อ่าน/ลบ ผ่าน (แท็บชั่วคราว _check ถูกลบแล้ว)');
      else {
        bad('เขียนแล้วอ่านกลับไม่ตรงกัน — ลองใหม่อีกครั้ง');
        exitCode = 1;
      }

      const created = await client.ensureTab().catch(() => false);
      const header = await client.readHeader().catch(() => []);
      if (header.length) ok(`แท็บ responses มีหัวตารางแล้ว ${header.length} คอลัมน์`);
      else if (args.includes('--init')) {
        const keys = await allQuestionKeys(db);
        const cols = mergeHeader([], keys);
        await client.writeHeader(cols);
        ok(`สร้างแท็บ responses${created ? '' : ' (มีอยู่แล้ว)'} + หัวตาราง ${cols.length} คอลัมน์ พร้อมจัดรูปแบบแล้ว`);
      } else {
        console.log('ℹ แท็บ responses ยังไม่มีหัวตาราง — จะถูกสร้างอัตโนมัติเมื่อมีรีวิวแรก หรือรัน: npm run sheets:check -- --init');
      }

      const [{ n: pending }] = await db('sheet_outbox').where({ status: 'pending' }).count({ n: '*' });
      const [{ n: failed }] = await db('sheet_outbox').where({ status: 'failed' }).count({ n: '*' });
      console.log(`ℹ คิวส่งขึ้นชีท: รอส่ง ${pending} แถว, ล้มเหลวถาวร ${failed} แถว${config.SHEETS_SYNC_ENABLED ? '' : ' | SHEETS_SYNC_ENABLED=false (ยังไม่ส่งจริง)'}`);
    } catch (err) {
      bad(`เรียก Google ไม่สำเร็จ: ${String(err.message ?? err).split('\n')[0]}`);
      const hint = explainGoogleError(err, { email: client.email, sheetId: config.GOOGLE_SHEET_ID });
      console.log(hint ? `  → ${hint}` : '  → ไม่ทราบสาเหตุ: ดูรายละเอียดใน docs/google-sheets.md หัวข้อ "แก้ปัญหา"');
      exitCode = 1;
    }
  }
} catch (err) {
  if (!err.handled) {
    bad(`เกิดข้อผิดพลาด: ${err.message}`);
    exitCode = 1;
  } else exitCode = 1;
} finally {
  await db.destroy();
}
process.exit(exitCode);
