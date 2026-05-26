/**
 * Faz Ü3.1 — subscriptions tablosu.
 *
 * Her site'nin tek aktif aboneliği olur (UNIQUE site_id WHERE status != 'cancelled').
 * cancelled bir abonelik tarihçe için saklanır; sonraki abonelik yeni satır.
 *
 * Status state machine:
 *   active → past_due (period_end geçti + ödeme bekleniyor)
 *   past_due → suspended (grace_period_ends_at geçti)
 *   suspended → active (ödeme alındı)
 *   suspended → cancelled (30 gün suspend sonrası veya kullanıcı isteği)
 *   active → cancelled (kullanıcı iptal, cancel_at_period_end=true → period sonu)
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('subscriptions', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('site_id').notNullable()
      .references('id').inTable('sites').onDelete('CASCADE');
    t.string('plan', 32).notNullable()
      .comment('baslangic / standart / pro / kurumsal');
    t.string('billing_cycle', 8).notNullable()
      .comment('monthly veya yearly');
    t.string('status', 16).notNullable().defaultTo('active')
      .comment('active / past_due / suspended / cancelled');
    t.string('provider', 16).nullable()
      .comment('iyzico / paytr / manual / null (baslangic ücretsizse)');
    t.string('provider_subscription_id', 128).nullable()
      .comment('Provider tarafındaki referans (iyzico subscriptionReferenceCode vb.)');
    t.timestamp('current_period_start', { useTz: true }).notNullable();
    t.timestamp('current_period_end', { useTz: true }).notNullable();
    t.boolean('cancel_at_period_end').notNullable().defaultTo(false);
    t.timestamp('grace_period_ends_at', { useTz: true }).nullable()
      .comment('past_due durumunda suspend olana kadar tanınan son tarih (7 gün)');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('site_id');
    t.index('status');
    t.index('current_period_end');
  });

  // Site başına tek aktif abonelik. cancelled olanlar tarihçedir.
  await knex.raw(`
    CREATE UNIQUE INDEX subscriptions_site_active_uniq
    ON subscriptions(site_id)
    WHERE status != 'cancelled'
  `);

  await knex.raw(`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_plan_check
    CHECK (plan IN ('baslangic', 'standart', 'pro', 'kurumsal'))
  `);
  await knex.raw(`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_cycle_check
    CHECK (billing_cycle IN ('monthly', 'yearly'))
  `);
  await knex.raw(`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'suspended', 'cancelled'))
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('subscriptions');
};
