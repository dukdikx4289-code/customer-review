import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { parseSheetId, parseServiceAccountKey, upsertEnv, explainGoogleError } from '../src/services/sheetsSetup.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

test('parseSheetId: รับ URL เต็ม / ID ล้วน / ปฏิเสธค่าที่ผิดรูป', () => {
  assert.equal(parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID);
  assert.equal(parseSheetId(`  ${ID}  `), ID);
  assert.equal(parseSheetId('https://example.com/not-a-sheet'), null);
  assert.equal(parseSheetId('short'), null);
  assert.equal(parseSheetId(undefined), null);
});

test('parseServiceAccountKey: ตรวจชนิดไฟล์และคืนอีเมล + base64 ที่ถอดกลับได้', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const key = { type: 'service_account', client_email: 'review@proj.iam.gserviceaccount.com', private_key: privateKey, project_id: 'proj' };
  const out = parseServiceAccountKey(JSON.stringify(key));
  assert.equal(out.email, key.client_email);
  assert.deepEqual(JSON.parse(Buffer.from(out.b64, 'base64').toString('utf8')), key);

  assert.throws(() => parseServiceAccountKey('not json'), /JSON/);
  assert.throws(() => parseServiceAccountKey(JSON.stringify({ type: 'authorized_user' })), /Service Account/);
  assert.throws(() => parseServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'a@b.c' })), /ไม่สมบูรณ์/);
});

test('upsertEnv: แทนค่าเดิม เพิ่มค่าใหม่ และไม่แตะบรรทัดอื่น/คอมเมนต์', () => {
  const before = '# comment\nPORT=3000\nGOOGLE_SHEET_ID=\nSHEETS_SYNC_ENABLED=false\n\nDB_PASSWORD=keep-me\n';
  const after = upsertEnv(before, { GOOGLE_SHEET_ID: 'abc', SHEETS_SYNC_ENABLED: 'true', GOOGLE_SERVICE_ACCOUNT_JSON_B64: 'Zm9v' });
  assert.match(after, /^# comment\nPORT=3000\nGOOGLE_SHEET_ID=abc\nSHEETS_SYNC_ENABLED=true\n/);
  assert.match(after, /DB_PASSWORD=keep-me\n/);
  assert.match(after, /GOOGLE_SERVICE_ACCOUNT_JSON_B64=Zm9v\n$/);
  assert.equal(after.match(/GOOGLE_SHEET_ID=/g).length, 1);
  assert.equal(upsertEnv('', { A: '1' }), 'A=1\n');
  // ทำซ้ำได้ (idempotent)
  assert.equal(upsertEnv(after, { GOOGLE_SHEET_ID: 'abc' }), after);
});

test('explainGoogleError: แปลง error ที่พบบ่อยเป็นคำแนะนำที่ถูกเรื่อง', () => {
  const email = 'review@proj.iam.gserviceaccount.com';
  assert.match(explainGoogleError({ status: 403, message: 'Google Sheets API has not been used in project 123 before or it is disabled' }, { email }), /เปิด Google Sheets API/);
  assert.match(explainGoogleError({ status: 403, message: 'The caller does not have permission' }, { email }), new RegExp(`Share.*${email}`));
  assert.match(explainGoogleError({ status: 404, message: 'Requested entity was not found.' }, { sheetId: ID }), /GOOGLE_SHEET_ID/);
  assert.match(explainGoogleError({ message: 'invalid_grant: Invalid JWT Signature.' }), /key ของ Service Account/);
  assert.match(explainGoogleError({ status: 429, message: 'Quota exceeded' }), /โควตา/);
  assert.match(explainGoogleError({ message: 'getaddrinfo ENOTFOUND sheets.googleapis.com' }), /อินเทอร์เน็ต/);
  assert.equal(explainGoogleError({ message: 'something else entirely' }), null);
});
