// Schema ใช้ได้ทั้ง MySQL 8 (dev) และ TiDB (prod): ไวยากรณ์ MySQL มาตรฐาน ไม่พึ่งฟีเจอร์เฉพาะเครื่อง
// หมายเหตุ TiDB: AUTO_INCREMENT ไม่เรียงต่อเนื่องเป๊ะ — เรียงข้อมูลด้วย submitted_at/created_at ไม่ใช่ id

const now = (knex) => knex.raw('CURRENT_TIMESTAMP(3)');

export async function up(knex) {
  await knex.schema.createTable('branches', (t) => {
    t.bigIncrements('id');
    t.string('code', 32).notNullable().unique();
    t.string('name', 120).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(now(knex));
  });

  await knex.schema.createTable('surveys', (t) => {
    t.bigIncrements('id');
    t.string('title', 200).notNullable();
    t.enu('status', ['draft', 'active', 'archived']).notNullable().defaultTo('draft');
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(now(knex));
  });

  // คำถามเก็บเป็น JSON ต่อเวอร์ชัน: แก้คำคำถามได้โดยคำตอบเก่ายังอ้างเวอร์ชันเดิม
  await knex.schema.createTable('survey_versions', (t) => {
    t.bigIncrements('id');
    t.bigInteger('survey_id').unsigned().notNullable().references('id').inTable('surveys');
    t.integer('version_no').notNullable();
    t.json('questions').notNullable();
    t.json('settings').nullable();
    t.datetime('published_at', { precision: 3 }).nullable();
    t.unique(['survey_id', 'version_no']);
  });

  // ไม่เก็บ token เต็ม: token = public_id + HMAC(secret, public_id + token_version)
  await knex.schema.createTable('share_links', (t) => {
    t.bigIncrements('id');
    t.string('public_id', 24).notNullable().unique();
    t.bigInteger('survey_id').unsigned().notNullable().references('id').inTable('surveys');
    t.enu('kind', ['customer', 'dashboard']).notNullable();
    t.bigInteger('branch_id').unsigned().nullable().references('id').inTable('branches'); // NULL = ทุกสาขา
    t.string('label', 200).notNullable();
    t.integer('token_version').notNullable().defaultTo(1);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.datetime('expires_at', { precision: 3 }).nullable();
    t.datetime('last_used_at', { precision: 3 }).nullable();
    t.integer('hit_count').notNullable().defaultTo(0);
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(now(knex));
    t.index(['kind', 'branch_id']);
  });

  await knex.schema.createTable('responses', (t) => {
    t.bigIncrements('id');
    t.bigInteger('survey_id').unsigned().notNullable().references('id').inTable('surveys');
    t.bigInteger('version_id').unsigned().notNullable().references('id').inTable('survey_versions');
    t.bigInteger('branch_id').unsigned().nullable().references('id').inTable('branches');
    t.bigInteger('link_id').unsigned().nullable().references('id').inTable('share_links');
    t.datetime('submitted_at', { precision: 3 }).notNullable().defaultTo(now(knex));
    t.json('meta').nullable();
    t.index(['branch_id', 'submitted_at']);
    t.index(['survey_id', 'submitted_at']);
  });

  await knex.schema.createTable('answers', (t) => {
    t.bigIncrements('id');
    t.bigInteger('response_id').unsigned().notNullable().references('id').inTable('responses').onDelete('CASCADE');
    t.string('question_key', 64).notNullable();
    t.decimal('value_number', 8, 2).nullable();
    t.text('value_text').nullable();
    t.json('value_json').nullable();
    t.index(['response_id']);
    t.index(['question_key', 'response_id']);
  });

  await knex.schema.createTable('admin_users', (t) => {
    t.bigIncrements('id');
    t.string('username', 64).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(now(knex));
  });

  await knex.schema.createTable('sheet_outbox', (t) => {
    t.bigIncrements('id');
    t.bigInteger('response_id').unsigned().notNullable().unique().references('id').inTable('responses').onDelete('CASCADE');
    t.enu('status', ['pending', 'sent', 'failed']).notNullable().defaultTo('pending');
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.datetime('next_attempt_at', { precision: 3 }).notNullable().defaultTo(now(knex));
    t.datetime('sent_at', { precision: 3 }).nullable();
    t.datetime('created_at', { precision: 3 }).notNullable().defaultTo(now(knex));
    t.index(['status', 'next_attempt_at']);
  });

  await knex.schema.createTable('sessions', (t) => {
    t.string('sid', 128).primary();
    t.text('sess').notNullable();
    t.datetime('expires_at', { precision: 3 }).notNullable();
    t.index(['expires_at']);
  });
}

export async function down(knex) {
  for (const table of [
    'sessions',
    'sheet_outbox',
    'admin_users',
    'answers',
    'responses',
    'share_links',
    'survey_versions',
    'surveys',
    'branches',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
