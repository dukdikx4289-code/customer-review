import 'dotenv/config';
// เทสต์ที่แตะฐานข้อมูลจะลบ/แก้ข้อมูล จึงอนุญาตเฉพาะ DB ในเครื่อง ห้ามรันกับ TiDB จริง
const host = process.env.DB_HOST ?? '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`ปฏิเสธการรันเทสต์: DB_HOST="${host}" ไม่ใช่ฐานข้อมูลในเครื่อง`);
  process.exit(1);
}
