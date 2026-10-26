// ตั้งรหัสผ่านแอดมินใหม่ (ลืมรหัส) — ใช้กับฐานข้อมูลในเครื่องเท่านั้น
// ใช้: npm run admin:reset [-- <username>]   (ไม่ระบุ = admin) แล้วพิมพ์รหัสใหม่ 2 ครั้ง (ไม่แสดงบนจอ)
import '../src/config.js';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/knex.js';
import { config } from '../src/config.js';

if (!['127.0.0.1', 'localhost', '::1'].includes(config.DB_HOST)) {
  console.error(`ปฏิเสธ: DB_HOST="${config.DB_HOST}" ไม่ใช่ฐานข้อมูลในเครื่อง — เว็บจริงให้เปลี่ยนรหัสที่หน้าแอดมิน เมนู บัญชี`);
  process.exit(1);
}

/** ถามรหัสโดยไม่แสดงตัวอักษรบนจอ */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const username = process.argv[2] ?? 'admin';
try {
  const user = await db('admin_users').where({ username }).first();
  if (!user) {
    const names = await db('admin_users').pluck('username');
    console.error(`ไม่พบผู้ใช้ "${username}" — มี: ${names.join(', ') || '(ไม่มี)'}`);
    process.exitCode = 1;
  } else {
    const password = await askHidden(`รหัสผ่านใหม่ของ "${username}" (อย่างน้อย 10 ตัว): `);
    const again = await askHidden('พิมพ์อีกครั้ง: ');
    if (password.length < 10) {
      console.error('รหัสสั้นเกินไป (อย่างน้อย 10 ตัวอักษร) — ไม่ได้เปลี่ยน');
      process.exitCode = 1;
    } else if (password !== again) {
      console.error('รหัสสองครั้งไม่ตรงกัน — ไม่ได้เปลี่ยน');
      process.exitCode = 1;
    } else {
      await db('admin_users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(password, 12) });
      console.log(`เปลี่ยนรหัสของ "${username}" แล้ว — ล็อกอินที่ ${config.PUBLIC_BASE_URL}/admin/`);
    }
  }
} finally {
  await db.destroy();
}
