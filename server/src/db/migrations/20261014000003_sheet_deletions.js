// คิวลบแถวใน Google Sheet เมื่อแอดมินลบคำตอบ (เช่น ข้อมูลทดสอบ) — worker ตัวเดียวกับ sheet_outbox เป็นผู้ลบ
// ไม่มี foreign key เพราะคำตอบถูกลบไปแล้ว เหลือแค่เลข response_id ไว้ค้นหาแถวในชีท (คอลัมน์ A)
export async function up(knex) {
  await knex.schema.createTable('sheet_deletions', (t) => {
    t.bigIncrements('id');
    t.bigInteger('response_id').unsigned().notNullable().unique();
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sheet_deletions');
}
