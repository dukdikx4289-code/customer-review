// แยกช่องทาง หน้าร้าน (store) / ออนไลน์ (online)
// - share_links.channel: ลิงก์ลูกค้าผูกกับช่องทาง (ลิงก์ผู้บริหาร = NULL) — ลิงก์ลูกค้าเดิมทั้งหมดถือเป็นหน้าร้าน
// - responses.channel: เก็บช่องทางไว้กับคำตอบเลย (ลิงก์ถูกลบได้ แต่ช่องทางของรีวิวต้องไม่หาย)
// - เผยแพร่คำถามเวอร์ชันใหม่ที่แบ่งช่องทาง (ของเดิมไม่ถูกแก้) โดยคงถ้อยคำ/คำถามที่แอดมินเพิ่มเองไว้
// ไวยากรณ์ MySQL มาตรฐาน ใช้ได้ทั้ง MySQL 8 และ TiDB

const ratingConfig = { min: 1, max: 5, labels: { 1: 'ควรปรับปรุง', 5: 'ดีเยี่ยม' } };
const BOTH = ['store', 'online'];

// snapshot ของชุดคำถาม ณ เวลาที่เขียน migration (ตรงกับ defaultQuestions ใน seeds/01_initial.js)
const CHANNEL_QUESTIONS = [
  { key: 'taste', type: 'rating', label: 'รสชาติ', required: true, channels: BOTH, config: ratingConfig },
  { key: 'food_quality', type: 'rating', label: 'คุณภาพอาหาร', required: true, channels: BOTH, config: ratingConfig },
  { key: 'staff_service', type: 'rating', label: 'การบริการของพนักงาน', required: true, channels: ['store'], config: ratingConfig },
  { key: 'cleanliness', type: 'rating', label: 'ความสะอาดของร้าน', required: true, channels: ['store'], config: ratingConfig },
  { key: 'delivery_on_time', type: 'rating', label: 'การจัดส่งตรงต่อเวลา', required: true, channels: ['online'], config: ratingConfig },
  { key: 'packaging', type: 'rating', label: 'สภาพบรรจุภัณฑ์เมื่อได้รับ', required: true, channels: ['online'], config: ratingConfig },
  { key: 'overall_satisfaction', type: 'rating', label: 'ความพึงพอใจในการสั่งอาหารครั้งนี้', required: true, channels: BOTH, config: ratingConfig },
  { key: 'comment', type: 'long_text', label: 'ข้อเสนอแนะเพิ่มเติม', required: false, channels: BOTH, config: { maxLength: 1000, placeholder: 'บอกเราเพิ่มเติมได้เลย (ไม่บังคับ)' } },
];

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function up(knex) {
  await knex.schema.alterTable('share_links', (t) => {
    t.enu('channel', ['store', 'online']).nullable();
  });
  await knex('share_links').where({ kind: 'customer' }).update({ channel: 'store' });

  await knex.schema.alterTable('responses', (t) => {
    t.enu('channel', ['store', 'online']).notNullable().defaultTo('store');
    t.index(['survey_id', 'channel', 'submitted_at']);
  });

  // ทุกแบบสอบถามที่มีอยู่: เผยแพร่ชุดคำถามแบ่งช่องทางเป็นเวอร์ชันใหม่ (ถ้ายังไม่เคยแบ่ง)
  const surveys = await knex('surveys').select('id');
  for (const { id } of surveys) {
    const latest = await knex('survey_versions').where({ survey_id: id }).orderBy('version_no', 'desc').first();
    if (!latest) continue;
    const current = parse(latest.questions) ?? [];
    if (current.some((q) => Array.isArray(q.channels))) continue;

    const byKey = new Map(current.map((q) => [q.key, q]));
    const known = new Set(CHANNEL_QUESTIONS.map((q) => q.key));
    const merged = CHANNEL_QUESTIONS.map((q) => (byKey.has(q.key) ? { ...byKey.get(q.key), channels: q.channels } : q));
    // คำถามที่แอดมินเพิ่มเอง: คงไว้ทั้งสองช่องทาง ก่อนข้อเสนอแนะ
    const extras = current.filter((q) => !known.has(q.key)).map((q) => ({ ...q, channels: BOTH }));
    const commentAt = merged.findIndex((q) => q.key === 'comment');
    merged.splice(commentAt, 0, ...extras);

    await knex('survey_versions').insert({
      survey_id: id,
      version_no: latest.version_no + 1,
      questions: JSON.stringify(merged),
      settings: typeof latest.settings === 'string' ? latest.settings : JSON.stringify(latest.settings ?? {}),
      published_at: knex.fn.now(3),
    });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('responses', (t) => {
    t.dropIndex(['survey_id', 'channel', 'submitted_at']);
    t.dropColumn('channel');
  });
  await knex.schema.alterTable('share_links', (t) => {
    t.dropColumn('channel');
  });
  // เวอร์ชันคำถามที่เผยแพร่ไปแล้วไม่ลบ (อาจมีคำตอบอ้างอิง) — แอดมินเผยแพร่ชุดใหม่แทนได้
}
