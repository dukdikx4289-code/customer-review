import { db } from '../db/knex.js';
import { parseJson } from './links.js';
import { shortLabel } from './questions.js';

/**
 * รายละเอียดคำตอบ 1 รีวิว (ใช้ทั้งแอดมินและลิงก์ผู้บริหาร)
 * scope.branchId = ลิงก์ผู้บริหารที่ผูกสาขา เห็นได้เฉพาะรีวิวของสาขานั้น — นอกขอบเขต/ไม่พบ คืน null (ตอบ 404 เหมือนกัน)
 * เรียงคำถามตามฟอร์มเวอร์ชันที่ลูกค้าตอบจริง ข้อที่ไม่อยู่ในเวอร์ชันนั้น (ไม่ควรเกิด) ต่อท้ายด้วยรหัสคำถาม
 */
export async function responseDetail(id, { surveyId, branchId = null } = {}) {
  const r = await db('responses as r')
    .leftJoin('branches as b', 'b.id', 'r.branch_id')
    .leftJoin('share_links as l', 'l.id', 'r.link_id')
    .where('r.id', id)
    .modify((q) => {
      if (surveyId) q.where('r.survey_id', surveyId);
      if (branchId) q.where('r.branch_id', branchId);
    })
    .first('r.id', 'r.survey_id', 'r.submitted_at', 'r.channel', 'r.version_id', 'b.name as branch', 'l.label as link');
  if (!r) return null;

  const version = await db('survey_versions').where({ id: r.version_id }).first('questions');
  const questions = parseJson(version?.questions) ?? [];
  const answers = await db('answers').where({ response_id: r.id });
  const byKey = new Map(answers.map((a) => [a.question_key, a]));

  const valueOf = (q, a) => {
    if (a.value_number != null) return Number(a.value_number);
    if (a.value_json != null) {
      const list = parseJson(a.value_json) ?? [];
      const labels = new Map((q?.config?.options ?? []).map((o) => [o.value, o.label]));
      return list.map((v) => labels.get(v) ?? v);
    }
    if (q?.type === 'single_choice') return (q.config?.options ?? []).find((o) => o.value === a.value_text)?.label ?? a.value_text;
    return a.value_text;
  };

  const items = [];
  for (const q of questions) {
    const a = byKey.get(q.key);
    byKey.delete(q.key);
    items.push({ key: q.key, label: shortLabel(q), type: q.type, max: q.config?.max ?? 5, value: a ? valueOf(q, a) : null });
  }
  // ข้อที่ไม่อยู่ในเวอร์ชันที่ลูกค้าตอบ (เช่น ข้อมูลเก่า/นำเข้า) — หาชื่อคำถาม/ตัวเลือกจากเวอร์ชันอื่น (ใหม่สุดก่อน) แทนการโชว์รหัส
  if (byKey.size) {
    const others = await db('survey_versions').where({ survey_id: surveyId ?? r.survey_id }).orderBy('version_no', 'desc').select('questions');
    const catalog = new Map();
    for (const v of others) for (const q of parseJson(v.questions) ?? []) if (!catalog.has(q.key)) catalog.set(q.key, q);
    for (const [key, a] of byKey) {
      const q = catalog.get(key);
      items.push({ key, label: shortLabel(q) ?? key, type: q?.type ?? (a.value_number != null ? 'rating' : 'text'), max: q?.config?.max ?? 5, value: valueOf(q, a) });
    }
  }

  return {
    id: r.id,
    submittedAt: new Date(r.submitted_at).toISOString(),
    branch: r.branch ?? null,
    channel: r.channel,
    link: r.link ?? null,
    // แสดงเฉพาะข้อที่ลูกค้าเห็นจริง (ข้อของอีกช่องทางที่ไม่ได้ถาม = ไม่มีคำตอบ ไม่ต้องแสดง เว้นแต่เป็นข้อไม่บังคับที่ข้ามไป)
    items: items.filter((it) => it.value != null || questions.find((q) => q.key === it.key && (!q.channels || q.channels.includes(r.channel)))),
  };
}
