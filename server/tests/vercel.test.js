import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

// Vercel Functions ของฟอร์มลูกค้า (api/_lib/form.js) — ต้องตอบเหมือน Express บน Render ทุกกรณี และ QR เดิมใช้ได้
process.env.NODE_ENV = 'test';

await import('./helpers/localOnly.js');
const { db } = await import('../src/db/knex.js');
const { newPublicId, newStaticSig } = await import('../src/services/tokens.js');
const { formHandler, _resetLimits } = await import('../../api/_lib/form.js');
const { default: loadFn } = await import('../../api/r/[token].js');
const { default: submitFn } = await import('../../api/r/[token]/submit.js');

const suffix = Date.now().toString(36);
const state = {};

/** จำลอง req/res ของ Vercel (Node IncomingMessage/ServerResponse + req.query/req.body) */
async function call(fn, { method = 'GET', token, body, headers = {}, badJson = false } = {}) {
  const req = { method, query: { token }, headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'vercel-test', ...headers } };
  Object.defineProperty(req, 'body', {
    get() {
      if (badJson) throw new SyntaxError('Unexpected token');
      return body;
    },
  });
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(text) {
      this.text = text;
    },
  };
  await fn(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.text ? JSON.parse(res.text) : undefined };
}

before(async () => {
  const survey = await db('surveys').where({ status: 'active' }).first();
  [state.branchId] = await db('branches').insert({ code: `VC${suffix}`.slice(0, 20).toUpperCase(), name: `ทดสอบ Vercel ${suffix}` });
  const link = (channel) => ({ kind: 'customer', label: `vercel ${channel}`, public_id: newPublicId(), static_sig: newStaticSig(), survey_id: survey.id, branch_id: state.branchId, channel });
  const choose = link('choose');
  const online = link('online');
  await db('share_links').insert([choose, online]);
  state.choose = `${choose.public_id}.${choose.static_sig}`;
  state.online = `${online.public_id}.${online.static_sig}`;
});

after(async () => {
  const rs = await db('responses').where({ branch_id: state.branchId }).pluck('id');
  if (rs.length) await db('responses').whereIn('id', rs).del();
  await db('share_links').where({ branch_id: state.branchId }).del();
  await db('branches').where({ id: state.branchId }).del();
  await db.destroy();
});

test('GET: QR แบบเลือกเอง ได้คำถามทั้ง 2 ช่องทาง, ไม่ส่ง id ภายใน, ห้ามแคช', async () => {
  const r = await call(loadFn, { token: state.choose });
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.body.channelChoice, true);
  assert.ok(r.body.questionsByChannel.store.length && r.body.questionsByChannel.online.length);
  assert.ok(!JSON.stringify(r.body).includes('"id"'));
  assert.ok(r.body.questions[0].channels === undefined);

  const fixed = await call(loadFn, { token: state.online });
  assert.equal(fixed.body.channel, 'online');
});

test('GET: token ผิด/ลายเซ็นผิด/ลิงก์ปิด = 404 เหมือนกัน, method ผิด = 405', async () => {
  assert.equal((await call(loadFn, { token: 'nope' })).status, 404);
  assert.equal((await call(loadFn, { token: `${state.choose.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA` })).status, 404);
  await db('share_links').where({ public_id: state.online.split('.')[0] }).update({ is_active: false });
  assert.equal((await call(loadFn, { token: state.online })).status, 404);
  await db('share_links').where({ public_id: state.online.split('.')[0] }).update({ is_active: true });
  assert.equal((await call(loadFn, { token: state.choose, method: 'POST' })).status, 405);
  assert.equal((await call(submitFn, { token: state.choose, method: 'GET' })).status, 405);
  _resetLimits();
});

test('POST: บันทึกคำตอบ + เข้าคิวชีท, ช่องทางตามที่ลูกค้าเลือก, ตรวจคำตอบเหมือน Render', async () => {
  const form = (await call(loadFn, { token: state.choose })).body;
  const answers = Object.fromEntries(form.questionsByChannel.online.filter((q) => q.type === 'rating').map((q) => [q.key, 4]));
  const ok = await call(submitFn, { method: 'POST', token: state.choose, body: { channel: 'online', answers, website: '' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.ok, true);
  const row = await db('responses').where({ branch_id: state.branchId }).orderBy('id', 'desc').first();
  assert.equal(row.channel, 'online');
  assert.equal((typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta).ua, 'vercel-test');
  assert.ok(await db('sheet_outbox').where({ response_id: row.id }).first());
  assert.equal((await db('answers').where({ response_id: row.id })).length, Object.keys(answers).length);

  const missing = await call(submitFn, { method: 'POST', token: state.choose, body: { channel: 'online', answers: {} } });
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error, 'invalid_answers');
  assert.equal((await call(submitFn, { method: 'POST', token: state.choose, badJson: true })).status, 400);
  assert.equal((await call(submitFn, { method: 'POST', token: state.choose, body: {}, headers: { 'content-length': '50000' } })).status, 413);

  // honeypot: ตอบสำเร็จแต่ไม่บันทึก
  const before = await db('responses').where({ branch_id: state.branchId }).count({ n: '*' }).first();
  assert.equal((await call(submitFn, { method: 'POST', token: state.choose, body: { answers, website: 'spam' } })).status, 201);
  const afterCount = await db('responses').where({ branch_id: state.branchId }).count({ n: '*' }).first();
  assert.equal(Number(afterCount.n), Number(before.n));
});

test('กันเดาลิงก์: token ผิดเกิน 30 ครั้งใน 10 นาที = 429 (แม้ token ถูก)', async () => {
  _resetLimits();
  for (let i = 0; i < 30; i++) await call(loadFn, { token: `bad${i}` });
  assert.equal((await call(loadFn, { token: state.choose })).status, 429);
  assert.equal((await call(loadFn, { token: state.choose, headers: { 'x-real-ip': '198.51.100.1' } })).status, 200); // IP อื่นไม่โดน
  _resetLimits();
});

test('connection หลุดระหว่าง instance พัก: ลองใหม่ 1 ครั้งแล้วสำเร็จ', async () => {
  let calls = 0;
  const original = db.client.acquireConnection;
  db.client.acquireConnection = async function patched(...args) {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' });
    return original.apply(this, args);
  };
  try {
    const r = await call(formHandler('load'), { token: state.choose });
    assert.equal(r.status, 200);
    assert.ok(calls > 1);
  } finally {
    db.client.acquireConnection = original;
  }
});
