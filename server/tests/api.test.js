import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// ต้องมี MySQL ที่ migrate + seed แล้ว (ใช้ค่า DB_* จาก server/.env)
process.env.NODE_ENV = 'test';
process.env.DASHBOARD_CACHE_TTL_SEC = '0';

await import('./helpers/localOnly.js');
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db/knex.js');
const { defaultQuestions } = await import('../src/db/seeds/01_initial.js');

const app = createApp();
const admin = request.agent(app);
const suffix = Date.now().toString(36);
const username = `test_${suffix}`;
const password = 'correct-horse-battery';
const state = {};

const tokenOf = (url) => url.split('/').pop();

before(async () => {
  await db('admin_users').insert({ username, password_hash: await bcrypt.hash(password, 4) });
});

after(async () => {
  const survey = await db('surveys').where({ status: 'active' }).first();
  if (state.branchId) {
    const rs = await db('responses').where({ branch_id: state.branchId }).pluck('id');
    if (rs.length) await db('responses').whereIn('id', rs).del();
    await db('share_links').where({ branch_id: state.branchId }).del();
    await db('branches').where({ id: state.branchId }).del();
  }
  await db('share_links').where({ label: `dash ${suffix}` }).del();
  // ลบเวอร์ชันที่เทสต์สร้างเพิ่ม (version_no > 1) ถ้าไม่มี response อ้างอิง
  const used = await db('responses').pluck('version_id');
  await db('survey_versions').where({ survey_id: survey.id }).where('version_no', '>', 1).whereNotIn('id', used.length ? used : [0]).del();
  await db('admin_users').where({ username }).del();
  await db.destroy();
});

test('admin API ไม่ล็อกอิน → 401', async () => {
  for (const path of ['/api/admin/branches', '/api/admin/links', '/api/admin/survey', '/api/admin/stats', '/api/admin/responses']) {
    assert.equal((await request(app).get(path)).status, 401, path);
  }
});

test('ล็อกอิน: รหัสผิด 401, ถูก 200 และมี cookie HttpOnly', async () => {
  assert.equal((await request(app).post('/api/admin/login').send({ username, password: 'wrong' })).status, 401);
  assert.equal((await request(app).post('/api/admin/login').send({ username: 'nobody', password })).status, 401);
  const res = await admin.post('/api/admin/login').send({ username, password });
  assert.equal(res.status, 200);
  assert.match(res.headers['set-cookie'][0], /HttpOnly/);
  assert.equal((await admin.get('/api/admin/me')).body.username, username);
});

test('สร้างสาขา + ลิงก์ลูกค้า + ลิงก์ผู้บริหาร', async () => {
  const b = await admin.post('/api/admin/branches').send({ code: `T${suffix}`.slice(0, 20).toUpperCase(), name: 'สาขาทดสอบ 😀' });
  assert.equal(b.status, 201);
  state.branchId = b.body.id;
  assert.equal((await admin.post('/api/admin/branches').send({ code: b.body.code, name: 'ซ้ำ' })).status, 409);

  const c = await admin.post('/api/admin/links').send({ kind: 'customer', branchId: state.branchId, label: `qr ${suffix}` });
  assert.equal(c.status, 201);
  state.customer = c.body;
  state.customerToken = tokenOf(c.body.url);
  assert.match(c.body.url, /\/r\/[0-9A-Za-z]{12}\.[A-Za-z0-9_-]{22}$/);

  const d = await admin.post('/api/admin/links').send({ kind: 'dashboard', label: `dash ${suffix}` });
  assert.equal(d.status, 201);
  state.dashboardToken = tokenOf(d.body.url);
  assert.match(d.body.url, /\/d\/[0-9A-Za-z]{12}\.[A-Za-z0-9_-]{43}$/);

  const noBranch = await admin.post('/api/admin/links').send({ kind: 'customer', label: 'x' });
  assert.equal(noBranch.status, 422);
});

test('QR: ได้ SVG และ PNG', async () => {
  const svg = await admin.get(`/api/admin/links/${state.customer.id}/qr`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers['content-type'], /svg/);
  const png = await admin.get(`/api/admin/links/${state.customer.id}/qr?format=png`).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(png.body.subarray(1, 4).toString(), 'PNG');
});

test('ฟอร์มลูกค้า: โหลดคำถามตามสาขา, token ปลอมได้ 404 เหมือนกันทุกกรณี', async () => {
  const ok = await request(app).get(`/api/r/${state.customerToken}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.branch.name, 'สาขาทดสอบ 😀');
  assert.deepEqual(ok.body.questions.map((q) => q.key).slice(0, 5), defaultQuestions.map((q) => q.key));
  assert.equal('id' in ok.body, false);

  const [pid, sig] = state.customerToken.split('.');
  const bads = [`${pid}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, `${'z'.repeat(12)}.${sig}`, 'garbage', `${pid}.${sig}.x`, state.dashboardToken];
  for (const t of bads) {
    const r = await request(app).get(`/api/r/${t}`);
    assert.equal(r.status, 404, t);
    assert.deepEqual(r.body, { error: 'not_found' });
  }
  // token ลูกค้าใช้กับ dashboard ไม่ได้ และกลับกัน
  assert.equal((await request(app).get(`/api/d/${state.customerToken}/stats`)).status, 404);
});

test('ส่งคำตอบ: ไม่ครบ 422, ครบ 201, honeypot ไม่บันทึก', async () => {
  const path = `/api/r/${state.customerToken}/submit`;
  assert.equal((await request(app).post(path).send({ answers: { taste: 5 } })).status, 422);
  assert.equal((await request(app).post(path).send({ answers: { taste: 9, food_quality: 5, delivery_on_time: 5, overall_satisfaction: 5 } })).status, 422);

  const good = { taste: 5, food_quality: 4, delivery_on_time: 2, overall_satisfaction: 4, comment: 'อร่อย <script>alert(1)</script> =SUM(1)' };
  const res = await request(app).post(path).send({ answers: good });
  assert.equal(res.status, 201);

  const before = await db('responses').where({ branch_id: state.branchId }).count({ n: '*' }).first();
  const bot = await request(app).post(path).send({ answers: good, website: 'http://spam' });
  assert.equal(bot.status, 201);
  const after = await db('responses').where({ branch_id: state.branchId }).count({ n: '*' }).first();
  assert.equal(Number(after.n), Number(before.n));

  const response = await db('responses').where({ branch_id: state.branchId }).first();
  const answers = await db('answers').where({ response_id: response.id });
  assert.equal(answers.length, 5);
  assert.ok(await db('sheet_outbox').where({ response_id: response.id, status: 'pending' }).first());
  assert.equal(answers.find((a) => a.question_key === 'comment').value_text, good.comment); // เก็บดิบ ไม่ตัดทอน (escape ตอนแสดงผล)
  const meta = typeof response.meta === 'string' ? JSON.parse(response.meta) : response.meta;
  assert.equal(meta.ua !== undefined, true);
});

test('Dashboard ผู้บริหาร: เห็นข้อมูลรวม, อ่านอย่างเดียว, header ถูกต้อง', async () => {
  const res = await request(app).get(`/api/d/${state.dashboardToken}/stats?range=all`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.body.totals.responses >= 1);
  const mine = res.body.branches.find((b) => b.id === state.branchId);
  assert.equal(mine.responses, 1);
  assert.equal(mine.scores.delivery_on_time.avg, 2);
  assert.equal(mine.scores.taste.avg, 5);
  // delivery 2 ดาว (n=1) ยังไม่ถึงเกณฑ์ตัวอย่างขั้นต่ำ จึงไม่ขึ้นเตือน
  assert.equal(res.body.attention.some((a) => a.branchId === state.branchId), false);
  assert.equal(res.body.comments.some((c) => c.branch === 'สาขาทดสอบ 😀'), true);
  assert.equal(res.body.distribution.length, 5);
  // การกระจายรายหัวข้อ: ครบ 5 ระดับทุกหัวข้อ และนับรีวิวทดสอบ (taste 5 ดาว, delivery 2 ดาว) ถูกช่อง
  const dist = Object.fromEntries(res.body.questions.map((q) => [q.key, q.distribution]));
  assert.ok(res.body.questions.every((q) => q.distribution.length === 5));
  assert.ok(dist.taste.find((d) => d.score === 5).count >= 1);
  assert.ok(dist.delivery_on_time.find((d) => d.score === 2).count >= 1);
  // ข้อมูลสำหรับ widget: minimap 7 วัน x 24 ชั่วโมง และช่วงก่อนหน้า (all = ไม่มี)
  assert.equal(res.body.activity.length, 7);
  assert.ok(res.body.activity.every((d) => d.hours.length === 24));
  assert.equal(res.body.previous, null);
  const month = await request(app).get(`/api/d/${state.dashboardToken}/stats?range=30d`);
  assert.deepEqual(Object.keys(month.body.previous).sort(), ['primaryAvg', 'responses', 'satisfactionRate']);
  assert.ok(month.body.activity.flatMap((d) => d.hours).reduce((a, b) => a + b, 0) >= 1);

  assert.equal((await request(app).post(`/api/d/${state.dashboardToken}/stats`).send({})).status, 404);
  assert.equal((await request(app).get(`/api/d/${state.dashboardToken}x/stats`)).status, 404);
});

test('แอดมินดูสถิติรายสาขา + รายการคำตอบ', async () => {
  const s = await admin.get(`/api/admin/stats?range=all&branch_id=${state.branchId}`);
  assert.equal(s.status, 200);
  assert.equal(s.body.totals.responses, 1);
  const r = await admin.get(`/api/admin/responses?branch_id=${state.branchId}`);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.items[0].answers.taste, 5);
});

test('เผยแพร่คำถามเวอร์ชันใหม่: ฟอร์มเปลี่ยนตาม, คำตอบเก่ายังอยู่', async () => {
  const current = await admin.get('/api/admin/survey');
  const questions = [...current.body.questions, { key: 'would_return', type: 'single_choice', label: 'จะกลับมาอีกไหม', required: false, config: { options: [{ value: 'yes', label: 'ใช่' }, { value: 'no', label: 'ไม่' }] } }];
  const pub = await admin.post('/api/admin/survey/publish').send({ questions });
  assert.equal(pub.status, 201);
  assert.equal(pub.body.version, current.body.version + 1);

  const form = await request(app).get(`/api/r/${state.customerToken}`);
  assert.equal(form.body.questions.at(-1).key, 'would_return');

  const bad = await admin.post('/api/admin/survey/publish').send({ questions: [...questions, questions[0]] });
  assert.equal(bad.status, 422);

  const res = await request(app).post(`/api/r/${state.customerToken}/submit`).send({ answers: { taste: 4, food_quality: 4, delivery_on_time: 4, overall_satisfaction: 4, would_return: 'yes' } });
  assert.equal(res.status, 201);
  const stats = await admin.get(`/api/admin/stats?range=all&branch_id=${state.branchId}`);
  assert.equal(stats.body.totals.responses, 2);
});

test('หมุนเวียนลิงก์: ลิงก์เก่าตาย ลิงก์ใหม่ใช้ได้; เพิกถอนแล้ว 404', async () => {
  const rot = await admin.post(`/api/admin/links/${state.customer.id}/rotate`);
  assert.equal(rot.status, 200);
  const newToken = tokenOf(rot.body.url);
  assert.notEqual(newToken, state.customerToken);
  assert.equal((await request(app).get(`/api/r/${state.customerToken}`)).status, 404);
  assert.equal((await request(app).get(`/api/r/${newToken}`)).status, 200);

  await admin.patch(`/api/admin/links/${state.customer.id}`).send({ isActive: false });
  assert.equal((await request(app).get(`/api/r/${newToken}`)).status, 404);

  await admin.patch(`/api/admin/links/${state.customer.id}`).send({ isActive: true, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await request(app).get(`/api/r/${newToken}`)).status, 404);
});

test('ออกจากระบบแล้วเข้า admin ไม่ได้', async () => {
  assert.equal((await admin.post('/api/admin/logout')).status, 200);
  assert.equal((await admin.get('/api/admin/branches')).status, 401);
});
