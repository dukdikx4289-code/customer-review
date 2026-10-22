// หน้าหลังส่ง 2 จังหวะ: "ส่งความคิดเห็นเรียบร้อยแล้ว 💚" → หน้าขอบคุณ (หัวข้อ + ข้อความ) — แอดมินแก้ได้ในหน้าแก้ไขคำถาม
// ใส่ข้อความเริ่มต้นให้ฟอร์มที่มีอยู่ (แก้เฉพาะ survey_versions.settings ที่ยังไม่ได้ตั้ง / ยังเป็นข้อความเริ่มต้นเดิม)
// ไม่แตะ share_links / คำถาม / คำตอบ → URL และ QR ทุกอันเหมือนเดิม

const OLD_DEFAULT = 'ขอบคุณสำหรับความคิดเห็นของคุณ';
const DEFAULTS = {
  sentTitle: 'ส่งความคิดเห็นเรียบร้อยแล้ว 💚',
  thanksTitle: 'ขอบคุณที่ให้เหนียวหมูไส้แตกดูแลมื้อนี้ของคุณ',
  thankYou: 'ความคิดเห็นของคุณจะช่วยให้เราปรับปรุงอาหารและบริการให้ดียิ่งขึ้น หวังว่าจะได้ดูแลคุณอีกครั้งในมื้อถัดไปนะคะ',
};

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v) ?? {};

export async function up(knex) {
  let updated = 0;
  for (const v of await knex('survey_versions').select('id', 'settings')) {
    const s = parse(v.settings);
    const next = { ...s };
    if (!s.thankYou?.trim() || s.thankYou.trim() === OLD_DEFAULT) next.thankYou = DEFAULTS.thankYou;
    next.sentTitle ??= DEFAULTS.sentTitle;
    next.thanksTitle ??= DEFAULTS.thanksTitle;
    if (JSON.stringify(next) === JSON.stringify(s)) continue;
    await knex('survey_versions').where({ id: v.id }).update({ settings: JSON.stringify(next) });
    updated++;
  }
  console.log(`thank_you_pages: ตั้งข้อความหน้าขอบคุณ ${updated} เวอร์ชัน (URL/QR เดิมไม่เปลี่ยน)`);
}

export async function down() {
  // ข้อความอย่างเดียว ไม่ต้องย้อน (หน้าเว็บเวอร์ชันเก่าใช้แค่ thankYou)
}
