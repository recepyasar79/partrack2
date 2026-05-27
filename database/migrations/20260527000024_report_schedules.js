/**
 * Faz Ü7.2 — Email rapor aboneliği tablosu.
 *
 * Site yöneticileri kendi siteleri için günlük/haftalık/aylık özet
 * raporlarını e-posta olarak alabilir. Cron `emailRaporu.js` her gün
 * çalışır; due olan schedule'lara mail gönderir, last_sent_at günceller.
 *
 * Frequency seçenekleri:
 *   - daily   → her gün
 *   - weekly  → her Pazartesi
 *   - monthly → ayın 1'i
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('report_schedules', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('site_id').notNullable()
      .references('id').inTable('sites').onDelete('CASCADE');
    t.string('email', 255).notNullable();
    t.string('frequency', 16).notNullable()
      .comment('daily / weekly / monthly');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('last_sent_at', { useTz: true }).nullable();
    t.bigInteger('created_by_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('site_id');
    t.index('enabled');
  });

  await knex.raw(`
    ALTER TABLE report_schedules
    ADD CONSTRAINT report_schedules_freq_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly'))
  `);
  // Site + email + frequency kombinasyonu eşsiz — aynı kullanıcı aynı
  // sıklıkta iki kayıt oluşturamaz.
  await knex.raw(`
    CREATE UNIQUE INDEX report_schedules_site_email_freq_uniq
    ON report_schedules(site_id, email, frequency)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('report_schedules');
};
