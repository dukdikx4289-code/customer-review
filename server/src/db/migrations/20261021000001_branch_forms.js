// ฟอร์มแยกสาขา: แต่ละสาขาเลือกได้ว่าใช้ "ฟอร์มกลาง" หรือ "ฟอร์มของสาขาเอง"
// - survey_versions.branch_id: NULL = ฟอร์มกลาง, มีค่า = เวอร์ชันของฟอร์มสาขานั้น (เลข version_no นับรวมทั้งแบบสอบถาม)
// - branches.custom_form: true = ลูกค้าสาขานี้เห็นเวอร์ชันล่าสุดของฟอร์มสาขา (ปิดกลับ = ใช้ฟอร์มกลาง, เวอร์ชันเดิมไม่ถูกลบ)
export async function up(knex) {
  await knex.schema.alterTable('survey_versions', (t) => {
    t.bigInteger('branch_id').unsigned().nullable().references('id').inTable('branches');
    t.index(['survey_id', 'branch_id', 'version_no']);
  });
  await knex.schema.alterTable('branches', (t) => {
    t.boolean('custom_form').notNullable().defaultTo(false);
  });
}

export async function down(knex) {
  // ฟอร์มสาขาที่เผยแพร่แล้วอาจมีคำตอบอ้างอิง จึงไม่ลบแถว — แค่ปลดออกจากสาขา (กลายเป็นเวอร์ชันเก่าของฟอร์มกลาง)
  await knex.schema.alterTable('branches', (t) => {
    t.dropColumn('custom_form');
  });
  await knex.schema.alterTable('survey_versions', (t) => {
    t.dropForeign(['branch_id']);
    t.dropIndex(['survey_id', 'branch_id', 'version_no']);
    t.dropColumn('branch_id');
  });
}
