/**
 * ocr_metrics.local_match_* — PR fallback kalibrasyonu (2026-06-16).
 * Her okumada, Plate Recognizer çağrılsa BİLE, PR'dan ÖNCEki yerel fuzzy
 * eşleşmesini (kaynak + skor + plaka) kaydeder. Amaç: "fuzzy-registered
 * eşleşmesine güvenip PR atlanabilir miydi, hangi skor eşiğinde doğru?"
 * sorusunu sahada ölçmek (FUZZY_TRUST_SCORE kalibrasyonu).
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('ocr_metrics', (t) => {
    t.text('local_match_source');     // learned-exact / fuzzy-registered / ...
    t.integer('local_match_score');   // 0-100 (yuvarlanmış)
    t.string('local_match_plate', 16);
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('ocr_metrics', (t) => {
    t.dropColumn('local_match_source');
    t.dropColumn('local_match_score');
    t.dropColumn('local_match_plate');
  });
};
