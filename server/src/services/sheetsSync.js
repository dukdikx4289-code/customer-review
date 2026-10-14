import { auth as googleAuth, sheets as sheetsApi } from '@googleapis/sheets';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { parseJson } from './links.js';

const TAB = 'responses';
const BATCH = 200;
const MAX_ATTEMPTS = 12;
const FIXED_COLUMNS = ['response_id', 'submitted_at (เวลาไทย)', 'branch_code', 'branch_name', 'link_label'];

/** แปลงเวลา UTC เป็นข้อความเวลาไทย  YYYY-MM-DD HH:mm:ss */
export function formatBangkok(date) {
  return new Date(new Date(date).getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** ลำดับคอลัมน์ = คอลัมน์ที่มีอยู่แล้วในชีท + คำถามใหม่ต่อท้าย (ไม่ลบ/ไม่สลับของเดิม) */
export function mergeHeader(existing, questionKeys) {
  const header = existing.length ? [...existing] : [...FIXED_COLUMNS];
  for (const key of questionKeys) if (!header.includes(key)) header.push(key);
  return header;
}

export function buildRow(header, response, answerMap) {
  const fixed = {
    [FIXED_COLUMNS[0]]: response.id,
    [FIXED_COLUMNS[1]]: formatBangkok(response.submitted_at),
    [FIXED_COLUMNS[2]]: response.branch_code ?? '',
    [FIXED_COLUMNS[3]]: response.branch_name ?? '',
    [FIXED_COLUMNS[4]]: response.link_label ?? '',
  };
  return header.map((col) => {
    if (col in fixed) return fixed[col];
    const v = answerMap[col];
    if (v === undefined || v === null) return '';
    return Array.isArray(v) ? v.join(', ') : v;
  });
}

/**
 * ตัวเชื่อม Google Sheets (ใช้ Service Account) — รับ credentials/ชีทจาก config เป็นค่าเริ่มต้น
 * ส่งค่าเองได้ (ใช้ในสคริปต์ตรวจการเชื่อมต่อ)
 */
export function createGoogleClient({ credentialsB64 = config.GOOGLE_SERVICE_ACCOUNT_JSON_B64, spreadsheetId = config.GOOGLE_SHEET_ID } = {}) {
  const credentials = JSON.parse(Buffer.from(credentialsB64, 'base64').toString('utf8'));
  const authClient = new googleAuth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const api = sheetsApi({ version: 'v4', auth: authClient });
  let tabId = null;

  /** หัวตาราง: ตัวหนา พื้นอุ่น ตรึงแถวแรก และปรับความกว้างคอลัมน์ — ล้มเหลวได้ (แค่ไม่สวย ไม่กระทบข้อมูล) */
  async function formatHeader(columns) {
    if (tabId == null) return;
    const header = { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 };
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { repeatCell: { range: header, cell: { userEnteredFormat: { backgroundColor: { red: 0.94, green: 0.92, blue: 0.88 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
          { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
          { autoResizeDimensions: { dimensions: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 0, endIndex: columns } } },
        ],
      },
    });
  }

  return {
    TAB,
    email: credentials.client_email,
    spreadsheetId,
    async info() {
      const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties(sheetId,title)' });
      return { title: meta.data.properties?.title ?? '', tabs: (meta.data.sheets ?? []).map((x) => x.properties.title) };
    },
    async ensureTab() {
      const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
      const found = meta.data.sheets?.find((x) => x.properties.title === TAB);
      if (found) {
        tabId = found.properties.sheetId;
        return false;
      }
      const res = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
      tabId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
      return true;
    },
    async readHeader() {
      const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!1:1` });
      return res.data.values?.[0] ?? [];
    },
    async writeHeader(header) {
      await api.spreadsheets.values.update({ spreadsheetId, range: `${TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [header] } });
      await formatHeader(header.length).catch(() => {});
    },
    async appendRows(rows) {
      // RAW: ค่าทุกตัวเป็นข้อความ/ตัวเลขตรงๆ ไม่ถูกตีความเป็นสูตร (กัน formula injection จากคอมเมนต์ที่ขึ้นต้นด้วย "=")
      await api.spreadsheets.values.append({
        spreadsheetId,
        range: `${TAB}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
    },
    /** ทดสอบเขียน→อ่าน→ลบ ในแท็บชั่วคราว _check (ไม่แตะแท็บ responses) */
    async selfTest() {
      const title = '_check';
      const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
      const id = add.data.replies?.[0]?.addSheet?.properties?.sheetId;
      try {
        const stamp = `ok ${new Date().toISOString()}`;
        await api.spreadsheets.values.update({ spreadsheetId, range: `${title}!A1`, valueInputOption: 'RAW', requestBody: { values: [[stamp]] } });
        const back = await api.spreadsheets.values.get({ spreadsheetId, range: `${title}!A1` });
        return back.data.values?.[0]?.[0] === stamp;
      } finally {
        await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: id } }] } }).catch(() => {});
      }
    },
  };
}

export async function allQuestionKeys(database = db) {
  const versions = await database('survey_versions').orderBy('id').select('questions');
  const keys = [];
  for (const v of versions) for (const q of parseJson(v.questions)) if (!keys.includes(q.key)) keys.push(q.key);
  return keys;
}

/**
 * ส่งแถวที่ค้างใน sheet_outbox ขึ้นชีทเป็นชุดเดียว
 * ล้มเหลว → เพิ่ม attempts และเลื่อนรอบถัดไปแบบ exponential backoff (ลูกค้าไม่ได้รับผลกระทบเพราะบันทึก DB ไปแล้ว)
 */
export async function runSyncOnce({ client, database = db, now = new Date() } = {}) {
  const pending = await database('sheet_outbox')
    .where({ status: 'pending' })
    .where('next_attempt_at', '<=', now)
    .orderBy('id')
    .limit(BATCH);
  if (!pending.length) return { sent: 0, failed: 0 };

  const ids = pending.map((p) => p.response_id);
  try {
    const responses = await database('responses as r')
      .leftJoin('branches as b', 'b.id', 'r.branch_id')
      .leftJoin('share_links as l', 'l.id', 'r.link_id')
      .whereIn('r.id', ids)
      .orderBy('r.submitted_at')
      .select('r.id', 'r.submitted_at', 'b.code as branch_code', 'b.name as branch_name', 'l.label as link_label');
    const answers = await database('answers').whereIn('response_id', ids);
    const byResponse = new Map();
    for (const a of answers) {
      const map = byResponse.get(a.response_id) ?? {};
      map[a.question_key] = a.value_number != null ? Number(a.value_number) : a.value_text ?? parseJson(a.value_json);
      byResponse.set(a.response_id, map);
    }

    await client.ensureTab();
    const existing = await client.readHeader();
    const header = mergeHeader(existing, await allQuestionKeys(database));
    if (header.length !== existing.length) await client.writeHeader(header);

    await client.appendRows(responses.map((r) => buildRow(header, r, byResponse.get(r.id) ?? {})));
    await database('sheet_outbox').whereIn('response_id', ids).update({ status: 'sent', sent_at: database.fn.now(3), last_error: null });
    return { sent: ids.length, failed: 0 };
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 500);
    for (const row of pending) {
      const attempts = row.attempts + 1;
      const delaySec = Math.min(30 * 2 ** attempts, 3600);
      await database('sheet_outbox').where({ id: row.id }).update({
        attempts,
        last_error: message,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        next_attempt_at: new Date(now.getTime() + delaySec * 1000),
      });
    }
    return { sent: 0, failed: pending.length, error: message };
  }
}

/** ตั้งค่า response ทั้งหมดเป็น pending เพื่อส่งใหม่ — ใช้กับชีทใหม่/ว่างเท่านั้น (ถ้าชีทมีข้อมูลเดิมจะซ้ำ) */
export async function queueBackfill(database = db) {
  await database.raw('INSERT IGNORE INTO sheet_outbox (response_id) SELECT id FROM responses');
  return database('sheet_outbox').update({ status: 'pending', attempts: 0, last_error: null, next_attempt_at: database.fn.now(3) });
}

export function startSheetsWorker() {
  if (!config.SHEETS_SYNC_ENABLED) {
    console.log('Google Sheets sync: ปิดอยู่ (SHEETS_SYNC_ENABLED=false)');
    return () => {};
  }
  let client;
  try {
    client = createGoogleClient();
  } catch (err) {
    // key เสีย/คัดลอกไม่ครบ: ห้ามทำให้ API ล่ม (ลูกค้าต้องส่งฟอร์มได้เสมอ) — คิวใน sheet_outbox จะสะสมไว้ส่งทีหลัง
    console.error(`Google Sheets sync: ปิดการทำงาน เพราะอ่าน GOOGLE_SERVICE_ACCOUNT_JSON_B64 ไม่ได้ (${err.message}) — รัน npm run sheets:check เพื่อตรวจ`);
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runSyncOnce({ client });
      if (r.sent || r.failed) console.log(`Sheets sync: ส่ง ${r.sent} แถว, ล้มเหลว ${r.failed}${r.error ? ` (${r.error})` : ''}`);
    } catch (err) {
      console.error('Sheets sync error', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.SHEETS_SYNC_INTERVAL_SEC * 1000);
  timer.unref();
  tick();
  console.log(`Google Sheets sync: เปิด ทุก ${config.SHEETS_SYNC_INTERVAL_SEC} วินาที`);
  return () => clearInterval(timer);
}
