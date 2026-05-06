/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('plate_learnings', (t) => {
    t.increments('id').primary();
    t.string('ocr_raw', 32).notNullable().comment('OCR okuması - orijinal ham hali');
    t.string('correct_plaka', 16).notNullable().comment('Kullanıcının onayladığı doğru plaka');
    t.integer('confirm_count').defaultTo(1).comment('Kaç kez onaylandı (learning weight)');
    t.timestamp('last_confirmed_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());

    // Her OCR sonucu için tek kayıt
    t.unique('ocr_raw');

    // Performans için index
    t.index('confirm_count');
    t.index('last_confirmed_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('plate_learnings');
};
