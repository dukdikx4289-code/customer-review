import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// แจ้งเตือนอีเมลรีวิวใหม่ (services/notify.js + /api/admin/notify) — ส่งผ่าน transport ปลอม ไม่ส่งอีเมลจริง
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'false';

await import('./helpers/localOnly.js');
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db/knex.js');
const { newPublicId, newStaticSig } = await import('../src/services/tokens.js');
const { flushEmails, buildEmail, isLowScore, isImportant, setNotifySettings, getNotifySettings, _resendTransport } = await import('../src/services/notify.js');

const app = createApp();
const admin = request.agent(app);
const suffix = Date.now().toString(36);
const username = `notify_${suffix}`;
const password = 'correct-horse-battery';
const state = {};
const mail = (domain) => `${suffix}@${domain}.example`;

/** transport ปลอม: เก็บอีเมลไว้ตรวจ · fail = จำลอง Resend ปฏิเสธ · delay = จำลองส่งช้า (เทสต์ส่งซ้ำ) */
const fakeTransport = ({ fail = false, delay = 0 } = {}) => ({
  sent: [],
  async send(msg) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail) throw new Error('Resend 403: The neawmoosaitaek.com domain is not verified');
    this.sent.push(msg);
  },
});
const mine = (t) => t.sent.filter((m) => m.subject.includes(`แจ้งเตือน ${suffix}`) || m.subject.includes('ทดสอบการแจ้งเตือน'));

async function submit(token, { score = 4, comment, website = '' } = {}) {
  const form = (await request(app).get(`/api/r/${token}`)).body;
  const answers = {};
  for (const q of form.questions) {
    if (q.type === 'rating') answers[q.key] = score;
    if (q.type === 'long_text' && comment) answers[q.key] = comment;
  }
  return request(app).post(`/api/r/${token}/submit`).send({ answers, website });
}
const lastResponse = (branchId) => db('responses').where({ branch_id: branchId }).orderBy('id', 'desc').first();

before(async () => {
  await db('admin_users').insert({ username, password_hash: await bcrypt.hash(password, 4) });
  const survey = await db('surveys').where({ status: 'active' }).first();
  const branch = (name) => db('branches').insert({ code: `N${name}${suffix}`.slice(0, 20).toUpperCase(), name: `แจ้งเตือน ${suffix} ${name}` });
  [state.branchA] = await branch('A');
  [state.branchB] = await branch('B');
  const link = (branchId) => ({ kind: 'customer', label: `notify ${suffix}`, public_id: newPublicId(), static_sig: newStaticSig(), survey_id: survey.id, branch_id: branchId, channel: 'store' });
  const a = link(state.branchA);
  const b = link(state.branchB);
  await db('share_links').insert([a, b]);
  state.tokenA = `${a.public_id}.${a.static_sig}`;
  state.tokenB = `${b.public_id}.${b.static_sig}`;
  state.settings = await getNotifySettings();
  // คิวค้างจากเทสต์อื่น/การใช้งานในเครื่อง — เคลียร์ก่อน ไม่ให้ปนกับของเทสต์นี้
  state.before = await db('email_outbox').whereNull('sent_at').whereNull('failed_at').pluck('id');
  if (state.before.length) await db('email_outbox').whereIn('id', state.before).update({ failed_at: new Date() });
});

after(async () => {
  await db('notify_recipients').where('email', 'like', `${suffix}@%`).del();
  await db('email_outbox').where({ kind: 'test' }).whereNotNull('sent_at').where('created_at', '>=', new Date(Date.now() - 600_000)).del();
  for (const id of [state.branchA, state.branchB]) {
    await db('responses').where({ branch_id: id }).del();
    await db('share_links').where({ branch_id: id }).del();
    await db('branches').where({ id }).del();
  }
  if (state.before?.length) await db('email_outbox').whereIn('id', state.before).update({ failed_at: null });
  await setNotifySettings(state.settings);
  await db('admin_users').where({ username }).del();
  await db.destroy();
});

test('เนื้อหาอีเมล: escape HTML ข้อความลูกค้า, หัวเรื่องมีสาขา/คะแนน, คะแนนต่ำมี ⚠️', () => {
  const detail = {
    id: 9,
    submittedAt: '2026-10-29T05:30:00.000Z',
    branch: 'สาขา <ทดสอบ>',
    channel: 'store',
    items: [
      { key: 'taste', label: 'รสชาติ', type: 'rating', max: 5, value: 2 },
      { key: 'food', label: 'อาหาร', type: 'rating', max: 5, value: 4 },
      { key: 'comment', label: 'ข้อเสนอแนะ', type: 'long_text', value: '<script>alert(1)</script> & "แพงไป"' },
    ],
  };
  const email = buildEmail(detail, { baseUrl: 'https://shop.example' });
  assert.match(email.subject, /^⚠️ \[รีวิวใหม่\] สาขา <ทดสอบ> · หน้าร้าน · เฉลี่ย 3\/5$/);
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;แพงไป&quot;'));
  assert.ok(email.html.includes('สาขา &lt;ทดสอบ&gt;'));
  assert.ok(email.text.includes('เวลา: 2026-10-29 12:30 น.')); // เวลาไทย
  assert.ok(email.text.includes('https://shop.example/admin/#/responses'));
  assert.equal(isLowScore(detail), true);

  const good = { ...detail, items: detail.items.slice(1, 2) };
  assert.equal(isLowScore(good), false);
  assert.equal(isImportant(good), false);
  assert.equal(isImportant({ ...good, items: [...good.items, detail.items[2]] }), true); // มีข้อเสนอแนะ = สำคัญ
  assert.ok(!buildEmail(good).subject.startsWith('⚠️'));
});

test('ส่งแบบสอบถาม → เข้าคิวอีเมล (honeypot ไม่เข้าคิว), ลบรีวิว → คิวหายตาม', async () => {
  assert.equal((await submit(state.tokenA)).status, 201);
  const r = await lastResponse(state.branchA);
  assert.ok(await db('email_outbox').where({ response_id: r.id, kind: 'response' }).first());

  const before = await db('email_outbox').count({ n: '*' }).first();
  assert.equal((await submit(state.tokenA, { website: 'bot' })).status, 201);
  assert.equal(Number((await db('email_outbox').count({ n: '*' }).first()).n), Number(before.n));

  await db('responses').where({ id: r.id }).del();
  assert.equal(await db('email_outbox').where({ response_id: r.id }).first(), undefined);
});

test('API ผู้รับ: ไม่ล็อกอิน 401, เพิ่มทุกสาขา/เฉพาะสาขา, อีเมลผิด 422, ซ้ำไม่เพิ่ม, ลบได้', async () => {
  assert.equal((await request(app).get('/api/admin/notify')).status, 401);
  assert.equal((await admin.post('/api/admin/login').send({ username, password })).status, 200);

  assert.equal((await admin.post('/api/admin/notify/recipients').send({ email: 'ไม่ใช่อีเมล' })).status, 422);
  assert.equal((await admin.post('/api/admin/notify/recipients').send({ email: mail('x'), branchIds: [99999999] })).status, 404);

  const all = await admin.post('/api/admin/notify/recipients').send({ email: mail('owner').toUpperCase() });
  assert.equal(all.status, 201);
  await admin.post('/api/admin/notify/recipients').send({ email: mail('owner') }); // ซ้ำ (ต่างแค่ตัวพิมพ์) = ข้าม
  await admin.post('/api/admin/notify/recipients').send({ email: mail('manager-a'), branchIds: [state.branchA] });
  await admin.post('/api/admin/notify/recipients').send({ email: mail('manager-b'), branchIds: [state.branchB] });
  await admin.post('/api/admin/notify/recipients').send({ email: mail('temp'), branchIds: [state.branchA, state.branchB] });

  const list = (await admin.get('/api/admin/notify')).body;
  const ours = list.recipients.filter((r) => r.email.startsWith(suffix));
  assert.equal(ours.filter((r) => r.email === mail('owner')).length, 1);
  assert.equal(ours.find((r) => r.email === mail('owner')).branchId, null);
  assert.equal(ours.filter((r) => r.email === mail('temp')).length, 2);
  assert.ok(ours.find((r) => r.email === mail('manager-a')).branch.includes(' A'));
  assert.equal(list.settings.mode, state.settings.mode);
  assert.equal(typeof list.stats.pending, 'number');

  for (const r of ours.filter((x) => x.email === mail('temp'))) assert.equal((await admin.delete(`/api/admin/notify/recipients/${r.id}`)).status, 200);
  assert.equal((await admin.delete('/api/admin/notify/recipients/99999999')).status, 404);
  assert.equal((await admin.put('/api/admin/notify/settings').send({ mode: 'sometimes' })).status, 422);
});

test('ส่งอีเมล: ผู้รับ = สาขานั้น + ทุกสาขา (ไม่รวมสาขาอื่น), สำเร็จแล้วไม่ส่งซ้ำ', async () => {
  await setNotifySettings({ mode: 'all' });
  await submit(state.tokenA, { score: 5 });
  await submit(state.tokenB, { score: 5 });
  const t = fakeTransport();
  await flushEmails({ transport: t });
  const sent = mine(t);
  const toA = sent.find((m) => m.subject.includes(`${suffix} A`));
  const toB = sent.find((m) => m.subject.includes(`${suffix} B`));
  assert.ok(toA && toB);
  assert.ok(toA.to.includes(mail('owner')) && toA.to.includes(mail('manager-a')) && !toA.to.includes(mail('manager-b')));
  assert.ok(toB.to.includes(mail('owner')) && toB.to.includes(mail('manager-b')) && !toB.to.includes(mail('manager-a')));
  assert.ok(toA.html.includes('5/5'));

  const again = fakeTransport();
  await flushEmails({ transport: again });
  assert.equal(mine(again).length, 0);
  const row = await db('email_outbox').where({ response_id: (await lastResponse(state.branchA)).id }).first();
  assert.equal(row.recipients, 2);
  assert.ok(row.sent_at);
});

test('โหมด "เฉพาะที่สำคัญ": ข้ามรีวิวคะแนนดีไม่มีข้อเสนอแนะ, ส่งรีวิวคะแนนต่ำ/มีข้อเสนอแนะ', async () => {
  await setNotifySettings({ mode: 'important' });
  await submit(state.tokenA, { score: 5 });
  const good = await lastResponse(state.branchA);
  await submit(state.tokenA, { score: 1 });
  const low = await lastResponse(state.branchA);
  await submit(state.tokenA, { score: 5, comment: 'ข้าวแข็งนิดหน่อย' });
  const commented = await lastResponse(state.branchA);

  const t = fakeTransport();
  await flushEmails({ transport: t });
  const subjects = mine(t).map((m) => m.subject);
  assert.equal(subjects.length, 2);
  assert.ok(subjects.some((s) => s.startsWith('⚠️') && s.includes('เฉลี่ย 1/5')));
  assert.equal((await db('email_outbox').where({ response_id: good.id }).first()).skipped, 1);
  assert.ok((await db('email_outbox').where({ response_id: low.id }).first()).sent_at);
  assert.ok((await db('email_outbox').where({ response_id: commented.id }).first()).sent_at);
  await setNotifySettings({ mode: 'all' });
});

test('ส่งไม่ผ่าน (เช่น โดเมนยังไม่ยืนยัน): เก็บ error + ลองใหม่รอบหน้าได้, ล้างคิวพร้อมกัน 2 ที่ไม่ส่งซ้ำ', async () => {
  await submit(state.tokenB, { score: 3 });
  const r = await lastResponse(state.branchB);
  await flushEmails({ transport: fakeTransport({ fail: true }) });
  const failed = await db('email_outbox').where({ response_id: r.id }).first();
  assert.equal(failed.attempts, 1);
  assert.match(failed.last_error, /not verified/);
  assert.equal(failed.sent_at, null);
  assert.equal((await admin.get('/api/admin/notify')).body.stats.lastError.message.includes('not verified'), true);

  const t1 = fakeTransport({ delay: 150 });
  const t2 = fakeTransport({ delay: 150 });
  await Promise.all([flushEmails({ transport: t1 }), flushEmails({ transport: t2 })]);
  const total = [...mine(t1), ...mine(t2)].filter((m) => m.subject.includes(`${suffix} B`));
  assert.equal(total.length, 1);
  assert.ok((await db('email_outbox').where({ response_id: r.id }).first()).sent_at);
});

test('อีเมลทดสอบ: ส่งถึงผู้รับทุกคน (ทุกสาขา + รายสาขา)', async () => {
  const t = fakeTransport();
  assert.equal((await admin.post('/api/admin/notify/test')).status, 201);
  await flushEmails({ transport: t });
  const test = mine(t).find((m) => m.subject.includes('ทดสอบการแจ้งเตือน'));
  assert.ok(test.to.includes(mail('owner')) && test.to.includes(mail('manager-a')) && test.to.includes(mail('manager-b')));
});

test('EMAIL_ENABLED=false และไม่มี transport: ไม่ส่งอะไร (เครื่อง dev/Render)', async () => {
  assert.deepEqual(await flushEmails(), { sent: 0, skipped: 0, failed: 0, disabled: true });
});

test('Resend API: POST พร้อม from/to/subject + Idempotency-Key, error ของ Resend ส่งต่อให้หน้าแอดมิน', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1
      ? new Response(JSON.stringify({ id: 'abc' }), { status: 200 })
      : new Response(JSON.stringify({ statusCode: 403, message: 'The neawmoosaitaek.com domain is not verified.' }), { status: 403 });
  };
  try {
    await _resendTransport.send({ to: ['a@example.com', 'b@example.com'], subject: 'หัวเรื่อง', text: 't', html: '<p>h</p>', idempotencyKey: 'email-outbox-7' });
    const { url, init } = calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.match(init.headers.Authorization, /^Bearer /);
    assert.equal(init.headers['Idempotency-Key'], 'email-outbox-7');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.to, ['a@example.com', 'b@example.com']);
    assert.equal(body.from, 'รีวิวเหนียวหมูไส้แตก <noreply@neawmoosaitaek.com>');
    assert.equal(body.subject, 'หัวเรื่อง');
    await assert.rejects(() => _resendTransport.send({ to: ['a@example.com'], subject: 's', text: 't', html: 'h' }), /Resend 403: The neawmoosaitaek.com domain is not verified/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
