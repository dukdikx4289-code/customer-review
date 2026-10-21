// แยกการแก้ไขฟอร์มทุกสาขา: ทุกสาขามีฟอร์มของตัวเอง (custom_form = true)
// สาขาที่ยังไม่มีเวอร์ชันของตัวเอง → คัดลอกฟอร์มกลางล่าสุด (ลูกค้าเห็นคำถามเหมือนเดิมทุกข้อ)
// ฟอร์มกลาง (branch_id IS NULL) กลายเป็น "แม่แบบสำหรับสาขาใหม่" และ fallback เท่านั้น
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function up(knex) {
  const surveys = await knex('surveys').select('id');
  const branches = await knex('branches').select('id');
  for (const { id: surveyId } of surveys) {
    const central = await knex('survey_versions').where({ survey_id: surveyId }).whereNull('branch_id').whereNotNull('published_at').orderBy('version_no', 'desc').first();
    if (!central) continue;
    for (const { id: branchId } of branches) {
      const own = await knex('survey_versions').where({ survey_id: surveyId, branch_id: branchId }).first('id');
      if (own) continue;
      const last = await knex('survey_versions').where({ survey_id: surveyId }).max({ n: 'version_no' }).first();
      await knex('survey_versions').insert({
        survey_id: surveyId,
        branch_id: branchId,
        version_no: Number(last?.n ?? 0) + 1,
        questions: JSON.stringify(parse(central.questions)),
        settings: JSON.stringify(parse(central.settings) ?? {}),
        published_at: knex.fn.now(3),
      });
    }
  }
  await knex('branches').update({ custom_form: true });
}

export async function down() {
  // ไม่ย้อนกลับ: ฟอร์มสาขาอาจถูกแก้/มีคำตอบอ้างอิงแล้ว — ถ้าต้องการให้สาขากลับไปใช้แม่แบบ ใช้ POST /api/admin/survey/branch-mode
}
