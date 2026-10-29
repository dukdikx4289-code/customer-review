// แจ้งเตือนอีเมลเมื่อมีรีวิวใหม่ (services/notify.js)
// - notify_recipients: ผู้รับ ต่อสาขา หรือ branch_id NULL = ทุกสาขา
// - email_outbox: คิวอีเมล 1 แถวต่อรีวิว (เข้าคิวใน transaction เดียวกับคำตอบ) + อีเมลทดสอบ — ส่งจาก Vercel (Render ฟรีบล็อกพอร์ตอีเมล)
// - app_settings: ค่าตั้งทั่วไปแบบ key/value (notify = { mode })
// ไม่แตะ share_links → URL และ QR ทุกอันเหมือนเดิม
export async function up(knex) {
  await knex.schema.createTable('notify_recipients', (t) => {
    t.bigIncrements('id');
    t.string('email', 254).notNullable();
    t.bigInteger('branch_id').unsigned().nullable().references('id').inTable('branches').onDelete('CASCADE');
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['email']);
  });

  await knex.schema.createTable('email_outbox', (t) => {
    t.bigIncrements('id');
    t.bigInteger('response_id').unsigned().nullable().references('id').inTable('responses').onDelete('CASCADE');
    t.enum('kind', ['response', 'test']).notNullable().defaultTo('response');
    t.string('to_email', 254).nullable(); // อีเมลทดสอบ: ส่งถึงผู้รับคนนี้ (NULL = ทุกผู้รับ)
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.string('claim_id', 32).nullable();
    t.datetime('claimed_at', { precision: 3 }).nullable();
    t.datetime('sent_at', { precision: 3 }).nullable();
    t.datetime('failed_at', { precision: 3 }).nullable();
    t.boolean('skipped').notNullable().defaultTo(false); // ไม่เข้าเกณฑ์/ไม่มีผู้รับ — ไม่ได้ส่งจริง
    t.integer('recipients').notNullable().defaultTo(0); // จำนวนผู้รับที่ส่งจริง (นับโควตา Gmail ต่อวัน)
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['sent_at', 'failed_at', 'claimed_at']);
  });

  await knex.schema.createTable('app_settings', (t) => {
    t.string('key', 64).primary();
    t.json('value').notNullable();
    t.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('app_settings');
  await knex.schema.dropTableIfExists('email_outbox');
  await knex.schema.dropTableIfExists('notify_recipients');
}
