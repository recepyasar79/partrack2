/**
 * plate_learnings tablosuna normalize_signature kolonu eklenir.
 *
 * Amaç: cache-first OCR akışında 2. katman lookup. Ham OCR çıktısı bire
 * bir bulunmazsa, karakter karışıklık sınıflarına (O↔0, I↔L↔1, T↔7, B↔8,
 * S↔5, Z↔2) göre indirgenmiş signature ile aranır. Plate Recognizer
 * API'sine gitmeden önceki son local hamle.
 *
 * Backfill: utils/plateNormalize.normalizeSignature ile mevcut ocr_raw
 * satırlarının signature'ını doldur. Index sonradan eklenir ki backfill
 * sırasında bloklamasın.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('plate_learnings', (t) => {
    t.string('normalize_signature', 32).nullable();
  });

  // Backfill — JS tarafında değil SQL'de yapıyoruz çünkü migration'lar
  // app code'una bağımlı olmamalı. Karakter sınıflarını TRANSLATE ile
  // tek geçişte uygula: O,Q→0; I,L→1; T→7; B→8; S→5; Z→2. TRANSLATE
  // pozisyon bazlı eşleştirir (from[i] → to[i]).
  await knex.raw(`
    UPDATE plate_learnings
    SET normalize_signature = TRANSLATE(
      UPPER(REGEXP_REPLACE(ocr_raw, '[^A-Za-z0-9]', '', 'g')),
      'OQILTBSZ',
      '00117852'
    )
    WHERE normalize_signature IS NULL
  `);

  await knex.raw('CREATE INDEX plate_learnings_signature_idx ON plate_learnings(normalize_signature)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS plate_learnings_signature_idx');
  await knex.schema.alterTable('plate_learnings', (t) => {
    t.dropColumn('normalize_signature');
  });
};
