import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  SESSION_SECRET: 'x'.repeat(32),
  LINK_SIGNING_SECRET: 's'.repeat(32),
  PUBLIC_BASE_URL: 'http://localhost:3000',
});

const tokens = await import('../src/services/tokens.js');
const { validateAnswers, parseQuestionDefinitions } = await import('../src/services/questions.js');
const { rangeStart, normalizeRange } = await import('../src/services/aggregate.js');
const { defaultQuestions } = await import('../src/db/seeds/01_initial.js');

const link = (over = {}) => ({ public_id: tokens.newPublicId(), kind: 'customer', token_version: 1, ...over });

test('token: สร้างแล้ว parse + verify ผ่าน', () => {
  const l = link();
  const parsed = tokens.parseToken(tokens.buildToken(l));
  assert.equal(parsed.publicId, l.public_id);
  assert.ok(tokens.verifySignature(l, parsed.signature));
});

test('token: ลายเซ็นยาวต่างกันตามชนิด (ลูกค้า 128 บิต / ผู้บริหาร 256 บิต)', () => {
  const c = tokens.buildToken(link({ kind: 'customer' })).split('.')[1];
  const d = tokens.buildToken(link({ kind: 'dashboard' })).split('.')[1];
  assert.equal(c.length, 22);
  assert.equal(d.length, 43);
});

test('token: เปลี่ยน version / ชนิด / secret แล้วใช้ไม่ได้', () => {
  const l = link();
  const { signature } = tokens.parseToken(tokens.buildToken(l));
  assert.equal(tokens.verifySignature({ ...l, token_version: 2 }, signature), false);
  assert.equal(tokens.verifySignature({ ...l, kind: 'dashboard' }, signature), false);
  assert.equal(tokens.verifySignature(l, signature, 'another-secret-another-secret-12345'), false);
});

test('token: รูปแบบผิดถูกปฏิเสธ', () => {
  for (const bad of ['', 'abc', 'a.b', `${'a'.repeat(12)}.`, `${'a'.repeat(12)}.${'b'.repeat(30)}.x`, null, undefined, 'x'.repeat(200)]) {
    assert.equal(tokens.parseToken(bad), null, String(bad));
  }
});

test('คำตอบ: ถูกต้องครบ', () => {
  const r = validateAnswers(defaultQuestions, { taste: 5, food_quality: '4', delivery_on_time: 3, overall_satisfaction: 5, comment: '  อร่อยมาก  ' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows.find((x) => x.question_key === 'comment'), { question_key: 'comment', value_text: 'อร่อยมาก' });
});

test('คำตอบ: ขาดข้อบังคับ / ค่านอกช่วง / ไม่ใช่จำนวนเต็ม', () => {
  const r = validateAnswers(defaultQuestions, { taste: 6, food_quality: 2.5, overall_satisfaction: 'abc' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { taste: 'invalid', food_quality: 'invalid', delivery_on_time: 'required', overall_satisfaction: 'invalid' });
});

test('คำตอบ: ข้อไม่บังคับเว้นว่างได้ และ key แปลกปลอมถูกเมิน', () => {
  const r = validateAnswers(defaultQuestions, { taste: 5, food_quality: 5, delivery_on_time: 5, overall_satisfaction: 5, hacked: 'x' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 4);
});

test('คำตอบ: ตัวเลือกต้องอยู่ในรายการ และข้อความถูกจำกัดความยาว', () => {
  const qs = [
    { key: 'source', type: 'single_choice', label: 'x', required: true, config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    { key: 'tags', type: 'multi_choice', label: 'y', required: false, config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    { key: 'note', type: 'short_text', label: 'z', required: false, config: { maxLength: 5 } },
  ];
  assert.equal(validateAnswers(qs, { source: 'c' }).ok, false);
  assert.equal(validateAnswers(qs, { source: 'a', tags: ['a', 'z'] }).ok, false);
  const ok = validateAnswers(qs, { source: 'a', tags: ['a', 'b', 'a'], note: '123456789\u0000' });
  assert.equal(ok.ok, true);
  assert.equal(ok.rows.find((x) => x.question_key === 'note').value_text, '12345');
  assert.equal(ok.rows.find((x) => x.question_key === 'tags').value_json, '["a","b"]');
});

test('นิยามคำถาม: key ซ้ำ / ชนิดผิด / ตัวเลือกไม่พอ ถูกปฏิเสธ', () => {
  assert.throws(() => parseQuestionDefinitions([...defaultQuestions, defaultQuestions[0]]));
  assert.throws(() => parseQuestionDefinitions([{ key: 'a1', type: 'nope', label: 'x' }]));
  assert.throws(() => parseQuestionDefinitions([{ key: 'a1', type: 'single_choice', label: 'x', config: { options: [{ value: 'a', label: 'A' }] } }]));
  assert.equal(parseQuestionDefinitions(defaultQuestions).length, 5);
});

test('ช่วงเวลา: เริ่มต้นวันตามเวลาไทย (UTC+7)', () => {
  // 2026-10-12 02:00 เวลาไทย = 2026-10-11 19:00 UTC → วันนี้ (ไทย) เริ่ม 2026-10-11T17:00Z
  const now = new Date('2026-10-11T19:00:00Z');
  assert.equal(rangeStart('7d', now).toISOString(), '2026-10-05T17:00:00.000Z');
  assert.equal(rangeStart('all', now), null);
  assert.equal(normalizeRange('bogus'), '30d');
});
