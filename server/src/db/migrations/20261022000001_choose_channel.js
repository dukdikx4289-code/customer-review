// QR เดียวต่อสาขา: ลิงก์ลูกค้าแบบ "choose" = สแกนแล้วให้ลูกค้าเลือกเองว่าสั่งหน้าร้านหรือออนไลน์
// - share_links.channel เพิ่มค่า 'choose' (responses.channel ยังเป็น store|online = ที่ลูกค้าเลือกจริง)
// - แปลงลิงก์ลูกค้าที่มีอยู่: สาขาดอนเมือง (มีแต่ออนไลน์) → 'online', สาขาอื่น → 'choose'
// ไม่แตะ public_id / static_sig / token_version → URL และ QR ทุกอันเหมือนเดิม ไม่ต้องพิมพ์ใหม่
// ไวยากรณ์ MySQL มาตรฐาน ใช้ได้ทั้ง MySQL 8 และ TiDB

const isDonMueang = (q) => q.where('code', 'DMK01').orWhere('name', 'like', '%ดอนเมือง%');

export async function up(knex) {
  await knex.raw("ALTER TABLE share_links MODIFY channel ENUM('store','online','choose') NULL");

  const donMueang = await knex('branches').where(isDonMueang).pluck('id');
  const toOnline = donMueang.length ? await knex('share_links').where({ kind: 'customer' }).whereIn('branch_id', donMueang).update({ channel: 'online' }) : 0;
  const toChoose = await knex('share_links')
    .where({ kind: 'customer' })
    .modify((q) => (donMueang.length ? q.whereNotIn('branch_id', donMueang) : q))
    .update({ channel: 'choose' });
  console.log(`choose_channel: ลิงก์ลูกค้าสาขาอื่น → เลือกเอง ${toChoose} ลิงก์ · ดอนเมือง → ออนไลน์ ${toOnline} ลิงก์ (URL/QR เดิมไม่เปลี่ยน)`);
}

export async function down(knex) {
  // ลิงก์แบบเลือกเองกลับไปเป็นหน้าร้าน — QR ยังเปิดได้ (แค่ไม่มีหน้าเลือก)
  await knex('share_links').where({ channel: 'choose' }).update({ channel: 'store' });
  await knex.raw("ALTER TABLE share_links MODIFY channel ENUM('store','online') NULL");
}
