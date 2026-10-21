// สร้างข้อมูลตัวอย่างสำหรับดู Dashboard:  npm run demo:data           (เพิ่มข้อมูล + ลิงก์ตัวอย่าง)
//                                      npm run demo:data -- --clear  (ลบข้อมูลตัวอย่างทั้งหมด)
// ใช้กับฐานข้อมูลในเครื่องเท่านั้น
import '../src/config.js';
import { db } from '../src/db/knex.js';
import { newPublicId, linkUrl } from '../src/services/tokens.js';

const host = process.env.DB_HOST;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`ปฏิเสธ: DB_HOST="${host}" ไม่ใช่ฐานข้อมูลในเครื่อง`);
  process.exit(1);
}

const DEMO_LABEL = '[ตัวอย่าง]';

if (process.argv.includes('--clear')) {
  const demoLinks = await db('share_links').where('label', 'like', `${DEMO_LABEL}%`).pluck('id');
  const ids = await db('responses')
    .where((q) => q.whereRaw("JSON_EXTRACT(meta, '$.demo') = true").orWhereIn('link_id', demoLinks.length ? demoLinks : [0]))
    .pluck('id');
  if (ids.length) await db('responses').whereIn('id', ids).del();
  const n = await db('share_links').where('label', 'like', `${DEMO_LABEL}%`).del();
  console.log(`ลบคำตอบตัวอย่าง ${ids.length} รายการ และลิงก์ตัวอย่าง ${n} รายการ`);
  await db.destroy();
  process.exit(0);
}

const survey = await db('surveys').where({ status: 'active' }).first();
const version = await db('survey_versions').where({ survey_id: survey.id }).whereNull('branch_id').orderBy('version_no', 'desc').first();
const branches = await db('branches').where({ is_active: true }).orderBy('code');

// ค่าเฉลี่ย "ที่ตั้งใจ" ต่อสาขา/หัวข้อ (สุ่มแบบคงที่ตามลำดับสาขา) เพื่อให้ Dashboard มีทั้งจุดดีและจุดที่ต้องแก้ไข
// หัวข้อที่ตอบขึ้นกับช่องทาง (หน้าร้าน/ออนไลน์) ตามคำถามเวอร์ชันล่าสุด
const questions = typeof version.questions === 'string' ? JSON.parse(version.questions) : version.questions;
const ratingKeys = (channel) => questions.filter((q) => q.type === 'rating' && (!q.channels || q.channels.includes(channel))).map((q) => q.key);
const profileFor = (i, channel) => {
  const base = [4.5, 4.2, 3.3, 4.0, 4.4, 3.6, 4.1, 4.3][i % 8];
  const means = {
    taste: base,
    food_quality: Math.min(4.8, base + 0.1),
    staff_service: i % 4 === 1 ? 3.1 : Math.min(4.8, base + 0.3), // บางสาขาบริการต้องปรับ
    cleanliness: Math.min(4.7, base + 0.1),
    delivery_on_time: i % 3 === 0 ? 3.0 : Math.min(4.7, base + 0.2), // บางสาขาส่งช้า
    packaging: Math.min(4.6, base),
    overall_satisfaction: base - 0.1,
  };
  return Object.fromEntries(ratingKeys(channel).map((k) => [k, means[k] ?? base]));
};
const comments = [
  'อร่อยมาก แต่ส่งช้าไปหน่อย',
  'ไรเดอร์สุภาพ อาหารยังร้อนอยู่',
  'รสชาติเค็มไปนิด',
  'ชอบมากค่ะ จะสั่งอีก',
  'บรรจุภัณฑ์ดี ไม่หก',
  'รออาหารนานกว่าที่แจ้งไว้ 20 นาที',
  'เมนูใหม่อร่อย ปริมาณพอดี',
  'ข้าวแข็งไปหน่อย',
];

const clamp = (n) => Math.min(5, Math.max(1, Math.round(n)));
const rnd = (mean) => clamp(mean + (Math.random() + Math.random() - 1) * 1.6);

const links = [];
for (const b of branches) {
  for (const [channel, name] of [['store', 'หน้าร้าน'], ['online', 'ออนไลน์']]) {
    const [id] = await db('share_links').insert({ public_id: newPublicId(), survey_id: survey.id, kind: 'customer', channel, branch_id: b.id, label: `${DEMO_LABEL} ${name} ${b.name}` });
    links.push({ id, branch: b, channel });
  }
}
const [dashId] = await db('share_links').insert({ public_id: newPublicId(), survey_id: survey.id, kind: 'dashboard', branch_id: null, label: `${DEMO_LABEL} ผู้บริหาร (ทุกสาขา)` });

let count = 0;
for (let day = 44; day >= 0; day--) {
  for (const { id: linkId, branch, channel } of links) {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.now() - day * 86_400_000 - Math.floor(Math.random() * 12 * 3_600_000));
      const p = profileFor(branches.indexOf(branch), channel);
      const [rid] = await db('responses').insert({ survey_id: survey.id, version_id: version.id, branch_id: branch.id, link_id: linkId, channel, submitted_at: at, meta: JSON.stringify({ demo: true }) });
      const rows = Object.entries(p).map(([key, mean]) => ({ response_id: rid, question_key: key, value_number: rnd(mean) }));
      if (Math.random() < 0.35) rows.push({ response_id: rid, question_key: 'comment', value_text: comments[Math.floor(Math.random() * comments.length)] });
      await db('answers').insert(rows);
      count++;
    }
  }
}

console.log(`สร้างคำตอบตัวอย่าง ${count} รายการ`);
console.log('\nลิงก์ตัวอย่าง (ใช้ได้เฉพาะเครื่องนี้):');
for (const { id } of links) {
  const l = await db('share_links').where({ id }).first();
  console.log(`  ${l.label}\n    ${linkUrl(l)}`);
}
const dash = await db('share_links').where({ id: dashId }).first();
console.log(`  ${dash.label}\n    ${linkUrl(dash)}`);
await db.destroy();
