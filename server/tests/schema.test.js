import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// ต้องมี MySQL (docker compose up -d) และรัน npm run db:migrate && npm run db:seed ไว้แล้ว
await import('./helpers/localOnly.js');
const { db } = await import('../src/db/knex.js');
const { defaultQuestions } = await import('../src/db/seeds/01_initial.js');

after(() => db.destroy());

test('ตารางหลักครบ', async () => {
  const [rows] = await db.raw('SHOW TABLES');
  const names = rows.map((r) => Object.values(r)[0]);
  for (const t of ['branches', 'surveys', 'survey_versions', 'share_links', 'responses', 'answers', 'admin_users', 'sheet_outbox', 'sessions']) {
    assert.ok(names.includes(t), `ไม่พบตาราง ${t}`);
  }
});

test('seed: มีสาขาและแบบสอบถาม 5 ข้อตามที่กำหนด', async () => {
  const branches = await db('branches').count({ n: '*' }).first();
  assert.ok(Number(branches.n) >= 3);

  const version = await db('survey_versions').where({ version_no: 1 }).first();
  const questions = typeof version.questions === 'string' ? JSON.parse(version.questions) : version.questions;
  assert.deepEqual(
    questions.map((q) => q.key),
    ['taste', 'food_quality', 'delivery_on_time', 'overall_satisfaction', 'comment'],
  );
  assert.deepEqual(questions, defaultQuestions);
});

test('เก็บภาษาไทยและอีโมจิได้ครบ (utf8mb4)', async () => {
  const label = 'ทดสอบ 😀 ข้อความไทย';
  const [id] = await db('branches').insert({ code: `T${Date.now()}`, name: label });
  const row = await db('branches').where({ id }).first();
  await db('branches').where({ id }).del();
  assert.equal(row.name, label);
});

test('ลบ response แล้ว answers ถูกลบตาม (cascade)', async () => {
  const survey = await db('surveys').first();
  const version = await db('survey_versions').where({ survey_id: survey.id }).first();
  const [rid] = await db('responses').insert({ survey_id: survey.id, version_id: version.id });
  await db('answers').insert({ response_id: rid, question_key: 'taste', value_number: 5 });
  await db('responses').where({ id: rid }).del();
  const left = await db('answers').where({ response_id: rid }).count({ n: '*' }).first();
  assert.equal(Number(left.n), 0);
});
