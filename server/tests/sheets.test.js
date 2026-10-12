import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

await import('./helpers/localOnly.js');
const { db } = await import('../src/db/knex.js');
const sync = await import('../src/services/sheetsSync.js');

after(() => db.destroy());

test('mergeHeader: ของเดิมอยู่ที่เดิม คำถามใหม่ต่อท้าย', () => {
  const first = sync.mergeHeader([], ['taste', 'comment']);
  assert.deepEqual(first.slice(-2), ['taste', 'comment']);
  const next = sync.mergeHeader(first, ['comment', 'new_q', 'taste']);
  assert.deepEqual(next, [...first, 'new_q']);
});

test('buildRow: เวลาไทย, คอลัมน์ว่างสำหรับคำถามที่ไม่มีคำตอบ, ไม่แปลงเป็นสูตร', () => {
  const header = sync.mergeHeader([], ['taste', 'comment', 'tags', 'old_q']);
  const row = sync.buildRow(
    header,
    { id: 7, submitted_at: new Date('2026-10-11T19:30:00Z'), branch_code: 'BKK01', branch_name: 'สยาม', link_label: 'QR โต๊ะ' },
    { taste: 5, comment: '=HYPERLINK("http://x")', tags: ['a', 'b'] },
  );
  assert.equal(row[1], '2026-10-12 02:30:00');
  assert.equal(row[header.indexOf('taste')], 5);
  assert.equal(row[header.indexOf('comment')], '=HYPERLINK("http://x")'); // ส่งเป็น RAW จึงไม่ถูก execute
  assert.equal(row[header.indexOf('tags')], 'a, b');
  assert.equal(row[header.indexOf('old_q')], '');
});

function fakeClient({ fail = false } = {}) {
  const calls = { header: [], rows: [] };
  return {
    calls,
    ensureTab: async () => {},
    readHeader: async () => calls.header.at(-1) ?? [],
    writeHeader: async (h) => calls.header.push(h),
    appendRows: async (rows) => {
      if (fail) throw new Error('quota exceeded');
      calls.rows.push(...rows);
    },
  };
}

async function makeResponse() {
  const survey = await db('surveys').first();
  const version = await db('survey_versions').where({ survey_id: survey.id }).first();
  const [id] = await db('responses').insert({ survey_id: survey.id, version_id: version.id });
  await db('answers').insert([
    { response_id: id, question_key: 'taste', value_number: 4 },
    { response_id: id, question_key: 'comment', value_text: 'ok' },
  ]);
  await db('sheet_outbox').insert({ response_id: id });
  return id;
}

test('runSyncOnce: ส่งเป็นชุดเดียว แล้วทำเครื่องหมาย sent', async () => {
  await db('sheet_outbox').del();
  const a = await makeResponse();
  const b = await makeResponse();
  const client = fakeClient();
  const result = await sync.runSyncOnce({ client });
  assert.equal(result.sent, 2);
  assert.equal(client.calls.rows.length, 2);
  assert.deepEqual(client.calls.rows.map((r) => r[0]).sort(), [a, b].sort());
  assert.equal((await db('sheet_outbox').where({ status: 'sent' })).length, 2);
  assert.equal((await sync.runSyncOnce({ client })).sent, 0); // รอบถัดไปไม่ส่งซ้ำ
  await db('responses').whereIn('id', [a, b]).del();
});

test('runSyncOnce: ล้มเหลว → ลูกค้าไม่กระทบ, เลื่อนรอบด้วย backoff, หายแล้วส่งสำเร็จ', async () => {
  await db('sheet_outbox').del();
  const id = await makeResponse();
  const failing = await sync.runSyncOnce({ client: fakeClient({ fail: true }) });
  assert.equal(failing.failed, 1);
  const row = await db('sheet_outbox').where({ response_id: id }).first();
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /quota/);
  assert.ok(new Date(row.next_attempt_at).getTime() > Date.now());

  assert.equal((await sync.runSyncOnce({ client: fakeClient() })).sent, 0); // ยังไม่ถึงเวลา retry

  const later = new Date(Date.now() + 2 * 3_600_000);
  const ok = await sync.runSyncOnce({ client: fakeClient(), now: later });
  assert.equal(ok.sent, 1);
  await db('responses').where({ id }).del();
});

test('queueBackfill: ตั้งทุก response เป็น pending', async () => {
  await db('sheet_outbox').del();
  const id = await makeResponse();
  await db('sheet_outbox').where({ response_id: id }).update({ status: 'sent' });
  await sync.queueBackfill();
  assert.equal((await db('sheet_outbox').where({ response_id: id }).first()).status, 'pending');
  await db('responses').where({ id }).del();
});
