import { db } from '../db/knex.js';
import { parseToken, verifySignature } from './tokens.js';

export function parseJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * ตรวจ token แล้วคืนแถว share_links (หรือ null)
 * ทุกกรณีที่ไม่ผ่าน (รูปแบบผิด / ลายเซ็นผิด / ถูกเพิกถอน / หมดอายุ) คืน null เหมือนกัน
 * เพื่อให้ผู้โจมตีแยกไม่ได้ว่าพลาดเพราะอะไร
 */
export async function resolveLink(token, kind, database = db) {
  const parsed = parseToken(token);
  if (!parsed) return null;

  const link = await database('share_links').where({ public_id: parsed.publicId, kind }).first();
  if (!link || !verifySignature(link, parsed.signature)) return null;
  if (!link.is_active) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return null;
  return link;
}

/**
 * เวอร์ชันคำถามที่ใช้อยู่: ถ้าระบุ branchId และสาขานั้นเปิด "ฟอร์มของสาขาเอง" → เวอร์ชันล่าสุดของสาขา
 * นอกนั้น (หรือสาขายังไม่เคยเผยแพร่ฟอร์มของตัวเอง) → เวอร์ชันล่าสุดของฟอร์มกลาง (branch_id IS NULL)
 */
export async function getLatestVersion(surveyId, { branchId = null, database = db } = {}) {
  const latest = (scope) =>
    database('survey_versions')
      .where({ survey_id: surveyId })
      .modify((q) => (scope ? q.where('branch_id', scope) : q.whereNull('branch_id')))
      .whereNotNull('published_at')
      .orderBy('version_no', 'desc')
      .first();
  let row = null;
  if (branchId) {
    const branch = await database('branches').where({ id: branchId }).first('custom_form');
    if (branch?.custom_form) row = await latest(branchId);
  }
  row ??= await latest(null);
  if (!row) return null;
  return { ...row, questions: parseJson(row.questions), settings: parseJson(row.settings) ?? {} };
}
