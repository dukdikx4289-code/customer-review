import bcrypt from 'bcryptjs';
import { config } from '../../config.js';

const SURVEY_TITLE = 'แบบประเมินความพึงพอใจ';

const ratingConfig = {
  min: 1,
  max: 5,
  labels: { 1: 'ควรปรับปรุง', 5: 'ดีเยี่ยม' },
};

// channels: หน้าร้าน (store) / ออนไลน์ (online) — ข้อที่อยู่ทั้งสองช่องทางรวมสถิติกันได้
// ชุดนี้ต้องตรงกับ migration 20261014000001_channels.js (ที่เผยแพร่ชุดเดียวกันให้ฐานข้อมูลเดิม)
const BOTH = ['store', 'online'];
export const defaultQuestions = [
  { key: 'taste', type: 'rating', label: 'รสชาติ', required: true, channels: BOTH, config: ratingConfig },
  { key: 'food_quality', type: 'rating', label: 'คุณภาพอาหาร', required: true, channels: BOTH, config: ratingConfig },
  { key: 'staff_service', type: 'rating', label: 'การบริการของพนักงาน', required: true, channels: ['store'], config: ratingConfig },
  { key: 'cleanliness', type: 'rating', label: 'ความสะอาดของร้าน', required: true, channels: ['store'], config: ratingConfig },
  { key: 'delivery_on_time', type: 'rating', label: 'การจัดส่งตรงต่อเวลา', required: true, channels: ['online'], config: ratingConfig },
  { key: 'packaging', type: 'rating', label: 'สภาพบรรจุภัณฑ์เมื่อได้รับ', required: true, channels: ['online'], config: ratingConfig },
  {
    key: 'overall_satisfaction',
    type: 'rating',
    label: 'ความพึงพอใจในการสั่งอาหารครั้งนี้',
    required: true,
    channels: BOTH,
    config: ratingConfig,
  },
  {
    key: 'comment',
    type: 'long_text',
    label: 'ข้อเสนอแนะเพิ่มเติม',
    required: false,
    channels: BOTH,
    config: { maxLength: 1000, placeholder: 'บอกเราเพิ่มเติมได้เลย (ไม่บังคับ)' },
  },
];

// สาขาจริงของเหนียวหมูไส้แตก (ชื่อจากที่อยู่ใน Google Maps) — รหัสสาขาเป็นรหัสย่อที่ตั้งเอง แก้ได้ที่หน้าแอดมิน
const sampleBranches = [
  { code: 'DMK01', name: '105 ถนนโกสุมรวมใจ ดอนเมือง' },
  { code: 'NGW01', name: 'หน้าโครงการ Sky Chill งามวงศ์วาน 23' },
  { code: 'PTN01', name: 'พัฒนาการ 53' },
  { code: 'BMT01', name: 'ปั๊ม PT พุทธมณฑลสาย 3' },
  { code: 'PRN01', name: 'ปั๊ม PT ถนนพระเทพตัดใหม่ พรานนก' },
  { code: 'KBR01', name: 'ปั๊ม PTT หนองหญ้าขาว M81 กาญจนบุรี' },
  { code: 'BNA01', name: 'ปั๊มบางจาก บางนา' },
  { code: 'RCY01', name: 'Box Space Ratchayothin รัชโยธิน' },
];

// ทำซ้ำได้ปลอดภัย (idempotent): รันกี่ครั้งก็ไม่สร้างข้อมูลซ้ำ
export async function seed(knex) {
  for (const b of sampleBranches) {
    const exists = await knex('branches').where({ code: b.code }).first();
    if (!exists) await knex('branches').insert(b);
  }

  let survey = await knex('surveys').where({ title: SURVEY_TITLE }).first();
  if (!survey) {
    const [surveyId] = await knex('surveys').insert({ title: SURVEY_TITLE, status: 'active' });
    await knex('survey_versions').insert({
      survey_id: surveyId,
      version_no: 1,
      questions: JSON.stringify(defaultQuestions),
      settings: JSON.stringify({ thankYou: 'ขอบคุณสำหรับความคิดเห็นของคุณ' }),
      published_at: knex.fn.now(3),
    });
    survey = { id: surveyId };
  }

  const { ADMIN_BOOTSTRAP_USER: user, ADMIN_BOOTSTRAP_PASSWORD: password } = config;
  if (user && password) {
    const exists = await knex('admin_users').where({ username: user }).first();
    if (!exists) {
      if (password.length < 10) throw new Error('ADMIN_BOOTSTRAP_PASSWORD ต้องยาวอย่างน้อย 10 ตัวอักษร');
      await knex('admin_users').insert({ username: user, password_hash: await bcrypt.hash(password, 12) });
      console.log(`สร้างแอดมิน "${user}" แล้ว — ลบ ADMIN_BOOTSTRAP_* ออกจาก env ได้`);
    }
  } else {
    console.log('ข้ามการสร้างแอดมิน (ไม่ได้ตั้ง ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASSWORD)');
  }
}
