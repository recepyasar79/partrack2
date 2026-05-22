/**
 * ocr_metrics — her OCR çağrısının ölçümü.
 *
 * Amaç: doğruluk/gecikme istatistiklerini gerçek veriyle takip etmek ve
 * iyileştirmelerin (Kademe 1: confidence early-exit, YOLO detection;
 * Kademe 2: Plate Recognizer hibrit) etkisini A/B karşılaştırabilmek.
 *
 * Akış: foto-upload → recognize → bir metric satırı oluşur. Kullanıcı
 * PATCH /kontroller/:id/plaka ile plakayı düzeltirse aynı satır
 * was_corrected_by_user=true olarak işaretlenir; doğruluk metriği
 * "kullanıcının dokunmadığı tahmin yüzdesi" üzerinden hesaplanabilir.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('ocr_metrics', (t) => {
    t.increments('id').primary();
    t.integer('gunluk_kontrol_id')
      .references('id')
      .inTable('gunluk_kontroller')
      .onDelete('CASCADE')
      .nullable()
      .comment('Hangi yüklemeye ait — kontrol silinince metric de gider');
    t.string('ocr_engine', 32).notNullable().defaultTo('easyocr');
    t.text('raw_text').nullable();
    t.string('plate_returned', 16).nullable();
    t.decimal('confidence', 5, 4).nullable();
    t.string('strategy', 64).nullable();
    t.integer('elapsed_ms').nullable();
    t.boolean('ocr_ok').notNullable().defaultTo(true);
    t.text('error').nullable();
    t.boolean('was_corrected_by_user').notNullable().defaultTo(false);
    t.string('corrected_to', 16).nullable();
    t.timestamp('corrected_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX ocr_metrics_kontrol_idx ON ocr_metrics(gunluk_kontrol_id)');
  await knex.raw('CREATE INDEX ocr_metrics_created_idx ON ocr_metrics(created_at)');
  await knex.raw('CREATE INDEX ocr_metrics_corrected_idx ON ocr_metrics(was_corrected_by_user)');
  await knex.raw('CREATE INDEX ocr_metrics_engine_idx ON ocr_metrics(ocr_engine)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ocr_metrics');
};
