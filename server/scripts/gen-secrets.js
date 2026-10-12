// พิมพ์ค่า secret สุ่มสำหรับตั้งใน .env / Render:  npm run secrets
import { randomBytes } from 'node:crypto';

const gen = () => randomBytes(32).toString('base64url');
console.log(`SESSION_SECRET=${gen()}`);
console.log(`LINK_SIGNING_SECRET=${gen()}`);
console.log('\nเก็บ LINK_SIGNING_SECRET ไว้ใน password manager — เปลี่ยนค่านี้ภายหลัง = QR/ลิงก์ที่แจกไปแล้วทั้งหมดใช้ไม่ได้');
