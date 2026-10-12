import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// ตั้งค่า env ก่อน import config เพื่อให้เทสต์ไม่ขึ้นกับไฟล์ .env ในเครื่อง
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  SESSION_SECRET: 'x'.repeat(32),
  LINK_SIGNING_SECRET: 'y'.repeat(32),
  PUBLIC_BASE_URL: 'http://localhost:3000',
});

const { createApp } = await import('../src/app.js');

test('GET /healthz ตอบ ok', async () => {
  const res = await request(createApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('route /api ที่ไม่มีอยู่ตอบ 404 เป็น JSON', async () => {
  const res = await request(createApp()).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});
