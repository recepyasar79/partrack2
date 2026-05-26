/**
 * Faz Ü3.1 — invoices tablosu.
 *
 * Her başarılı dönem için bir fatura. invoice_no insan-okunabilir
 * sıralı numara (örn. 2026-05-00001). Paraşüt entegrasyonu (Ü3.7)
 * sonrası parasut_invoice_id + pdf_url doldurulur.
 *
 * Para tutarları KURUŞ cinsinden saklanır (integer) — floating point
 * yuvarlama sorunlarından kaçınmak için. amount_excl_tax + tax = amount_incl_tax.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('invoices', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('site_id').notNullable()
      .references('id').inTable('sites').onDelete('CASCADE');
    t.bigInteger('subscription_id').notNullable()
      .references('id').inTable('subscriptions').onDelete('CASCADE');
    t.string('invoice_no', 32).notNullable().unique()
      .comment('İnsan okunabilir: 2026-05-00001');
    t.integer('amount_excl_tax').notNullable()
      .comment('Kuruş, KDV hariç');
    t.integer('tax_rate').notNullable().defaultTo(20)
      .comment('KDV yüzdesi (Türkiye 2026: %20)');
    t.integer('amount_incl_tax').notNullable()
      .comment('Kuruş, KDV dahil — toplam tahsil edilen');
    t.string('currency', 3).notNullable().defaultTo('TRY');
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.string('status', 16).notNullable().defaultTo('pending')
      .comment('draft / pending / paid / failed / refunded');
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('paid_at', { useTz: true }).nullable();
    t.string('parasut_invoice_id', 64).nullable()
      .comment('Paraşüt e-fatura referansı (Ü3.7)');
    t.string('pdf_url', 500).nullable()
      .comment('Paraşüt PDF URL — kullanıcı indirebilsin');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('site_id');
    t.index('subscription_id');
    t.index('status');
    t.index('issued_at');
  });

  await knex.raw(`
    ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'pending', 'paid', 'failed', 'refunded'))
  `);
  await knex.raw(`
    ALTER TABLE invoices
    ADD CONSTRAINT invoices_amount_nonneg_check
    CHECK (amount_excl_tax >= 0 AND amount_incl_tax >= 0)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('invoices');
};
