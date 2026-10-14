// QR ลูกค้าคงที่: เก็บรหัสประจำลิงก์ (static_sig) ใน DB แทนการคำนวณจาก LINK_SIGNING_SECRET
// ลิงก์ลูกค้าเดิม: เติม static_sig = ลายเซ็น HMAC ปัจจุบัน → QR ที่พิมพ์ไปแล้วยังใช้ได้เหมือนเดิม
// และหลังจากนี้ไม่พังแม้เปลี่ยน/ทำ LINK_SIGNING_SECRET หาย
import { createHmac } from 'node:crypto';

const hmac = (secret, publicId, version) =>
  createHmac('sha256', secret).update(`customer:${publicId}:${version}`).digest().subarray(0, 16).toString('base64url');

export async function up(knex) {
  await knex.schema.alterTable('share_links', (t) => {
    t.string('static_sig', 64).nullable();
  });

  const links = await knex('share_links').where({ kind: 'customer' }).whereNull('static_sig').select('id', 'public_id', 'token_version');
  if (!links.length) return;
  const secret = process.env.LINK_SIGNING_SECRET;
  if (!secret) throw new Error('ต้องตั้ง LINK_SIGNING_SECRET เพื่อคงลิงก์ลูกค้าเดิมไว้');
  for (const l of links) {
    await knex('share_links').where({ id: l.id }).update({ static_sig: hmac(secret, l.public_id, l.token_version) });
  }
}

export async function down(knex) {
  // ลิงก์ที่สร้างหลัง migration นี้ (รหัสสุ่ม) จะใช้ไม่ได้หลัง rollback — ลิงก์เดิมกลับไปใช้ HMAC ได้ตามเดิม
  await knex.schema.alterTable('share_links', (t) => {
    t.dropColumn('static_sig');
  });
}
