/**
 * plate_char_substitutions — saha-spesifik OCR karakter karışıklığı.
 *
 * Amaç: bir sitede "5 çoğunlukla S okunuyor" gibi pattern'leri öğrenip
 * fuzzy match'i o yönde biaslamak. plate_learnings sadece tam string
 * eşleşmesi tutuyor; o tablo "bu ham OCR → bu doğru plaka" diyor.
 * Bu tablo ise sebebi: "1 ile L karıştırılıyor" diyor — yeni hiç
 * görmediği plakalarda bile aynı substitution'u uygulayabilelim.
 *
 * Site_id kolonu Faz Ü1 (multi-tenant) içinde eklenecek; şu an global.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('plate_char_substitutions', (t) => {
    t.increments('id').primary();
    t.string('from_char', 1).notNullable().comment('OCR ne okudu');
    t.string('to_char', 1).notNullable().comment('Kullanıcı ne düzeltti');
    t.integer('count').notNullable().defaultTo(1);
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['from_char', 'to_char']);
    t.index('count');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('plate_char_substitutions');
};
