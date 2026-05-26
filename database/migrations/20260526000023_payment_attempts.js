/**
 * Faz Ü3.1 — payment_attempts tablosu.
 *
 * Bir fatura için yapılan tüm ödeme denemeleri (başarılı + başarısız).
 * İdempotency: provider_payment_id UNIQUE — aynı provider event'i iki
 * kez işlenmez. Webhook retry'lar güvenli.
 *
 * raw_response JSONB: provider'dan dönen tam cevap (debug + dispute için).
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('payment_attempts', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('invoice_id').notNullable()
      .references('id').inTable('invoices').onDelete('CASCADE');
    t.string('provider', 16).notNullable()
      .comment('iyzico / paytr / manual');
    t.string('provider_payment_id', 128).nullable()
      .comment('Provider transaction id — idempotency key');
    t.string('status', 16).notNullable().defaultTo('pending')
      .comment('pending / success / failed');
    t.integer('amount').notNullable()
      .comment('Kuruş, KDV dahil — tahsil edilen tutar');
    t.integer('attempt_no').notNullable().defaultTo(1)
      .comment('Bu fatura için kaçıncı deneme');
    t.text('error_message').nullable();
    t.jsonb('raw_response').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('invoice_id');
    t.index('status');
    t.index('created_at');
  });

  // Provider event idempotency — aynı provider_payment_id iki kez işlenmez.
  // NULL'lar UNIQUE'ten muaf (manual/pending kayıtları için).
  await knex.raw(`
    CREATE UNIQUE INDEX payment_attempts_provider_id_uniq
    ON payment_attempts(provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_status_check
    CHECK (status IN ('pending', 'success', 'failed'))
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payment_attempts');
};
