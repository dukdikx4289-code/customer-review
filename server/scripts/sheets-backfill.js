import { db } from '../src/db/knex.js';
import { queueBackfill } from '../src/services/sheetsSync.js';

// ใช้กับชีทใหม่/ว่างเท่านั้น: จะตั้งคำตอบทุกแถวให้ส่งใหม่ (ถ้าชีทมีข้อมูลเดิมอยู่แล้วจะเกิดแถวซ้ำ)
if (!process.argv.includes('--yes')) {
  console.log('คำสั่งนี้จะส่งคำตอบทั้งหมดขึ้นชีทใหม่อีกครั้ง ใช้เฉพาะกับชีทที่ว่างเปล่า\nรันซ้ำพร้อม --yes เพื่อยืนยัน:  npm run sheets:backfill -- --yes');
  process.exit(0);
}

const n = await queueBackfill();
console.log(`ตั้งคิวส่งใหม่ ${n} แถว — worker จะส่งในรอบถัดไป (ต้องเปิด SHEETS_SYNC_ENABLED=true และเซิร์ฟเวอร์ทำงานอยู่)`);
await db.destroy();
