/**
 * Multi-tenant Faz Ü1.2 — 11 domain tablosuna site_id kolonu.
 *
 * Sırasıyla şunlar yapılır her tabloda:
 *   1. site_id BIGINT NULL kolon ekle (NOT NULL backfill öncesi çalışmaz)
 *   2. Mevcut tüm satırları default site (id=1) ile backfill
 *   3. NOT NULL constraint + FK references sites(id)
 *   4. Performans index (site_id veya composite)
 *   5. Mevcut UNIQUE constraint'leri composite (site_id, ...) hale getir
 *
 * Etkilenen UNIQUE'ler:
 *   - daireler.daire_no              → (site_id, daire_no)
 *   - araclar partial idx WHERE aktif → (site_id, plaka) WHERE aktif
 *   - plate_learnings.ocr_raw         → (site_id, ocr_raw)
 *   - plate_char_substitutions(from,to) → (site_id, from, to)
 *
 * users.kullanici_adi platform-wide UNIQUE olarak KALIR — login için tek
 * isim mantıklı; farklı sitelerde aynı username yönetimi karmaşıklaştırır.
 *
 * Migration sırası: Ü1.1 default site (id=1) oluşturduktan sonra çalışır.
 * Aksi halde backfill başarısız olur (FK violation).
 *
 * @param { import("knex").Knex } knex
 */

// 9 domain tablosu + 2 OCR yan tablosu
const SIMPLE_TABLES = [
  'daireler',
  'gunluk_kontroller',
  'ihlaller',
  'bildirimler',
  'daire_sahip_tarihce',
  'misafir_araclar',
  'audit_log',
  'ocr_metrics',
];

async function addSiteIdColumn(knex, table) {
  await knex.schema.alterTable(table, (t) => {
    t.bigInteger('site_id').nullable()
      .references('id').inTable('sites');
  });
  await knex(table).update({ site_id: 1 });
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN site_id SET NOT NULL`);
  await knex.raw(`CREATE INDEX ${table}_site_id_idx ON ${table}(site_id)`);
}

exports.up = async function up(knex) {
  // Default site var mı doğrula (Ü1.1 çalışmış olmalı)
  const defaultSite = await knex('sites').where({ id: 1 }).first();
  if (!defaultSite) {
    throw new Error('Default site (id=1) bulunamadı — Ü1.1 migration önce çalışmalı.');
  }

  // 1. Basit tablolar: kolon ekle + backfill + NOT NULL + index
  for (const table of SIMPLE_TABLES) {
    await addSiteIdColumn(knex, table);
  }

  // 2. daireler: daire_no UNIQUE → (site_id, daire_no) composite
  //    Önce site_id zaten eklendi (SIMPLE_TABLES içinde). Şimdi UNIQUE'i taşı.
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_daire_no_unique');
  await knex.raw('ALTER TABLE daireler ADD CONSTRAINT daireler_site_daire_no_uniq UNIQUE (site_id, daire_no)');

  // 3. araclar: site_id ekle + partial UNIQUE WHERE aktif=true composite
  await knex.schema.alterTable('araclar', (t) => {
    t.bigInteger('site_id').nullable().references('id').inTable('sites');
  });
  await knex('araclar').update({ site_id: 1 });
  await knex.raw('ALTER TABLE araclar ALTER COLUMN site_id SET NOT NULL');
  await knex.raw('CREATE INDEX araclar_site_id_idx ON araclar(site_id)');
  // Eski partial unique drop + composite create
  await knex.raw('DROP INDEX IF EXISTS araclar_plaka_aktif_uniq');
  await knex.raw('CREATE UNIQUE INDEX araclar_site_plaka_aktif_uniq ON araclar(site_id, plaka) WHERE aktif = true');

  // 4. plate_learnings: site_id ekle + ocr_raw UNIQUE composite
  await knex.schema.alterTable('plate_learnings', (t) => {
    t.bigInteger('site_id').nullable().references('id').inTable('sites');
  });
  await knex('plate_learnings').update({ site_id: 1 });
  await knex.raw('ALTER TABLE plate_learnings ALTER COLUMN site_id SET NOT NULL');
  await knex.raw('CREATE INDEX plate_learnings_site_id_idx ON plate_learnings(site_id)');
  await knex.raw('ALTER TABLE plate_learnings DROP CONSTRAINT IF EXISTS plate_learnings_ocr_raw_unique');
  await knex.raw('ALTER TABLE plate_learnings ADD CONSTRAINT plate_learnings_site_ocr_raw_uniq UNIQUE (site_id, ocr_raw)');
  // Mevcut signature index'i (Ü0/15. migration'da yaratılmıştı) site_id ile composite hale getir
  await knex.raw('DROP INDEX IF EXISTS plate_learnings_signature_idx');
  await knex.raw('CREATE INDEX plate_learnings_site_signature_idx ON plate_learnings(site_id, normalize_signature)');

  // 5. plate_char_substitutions: site_id ekle + (from,to) UNIQUE composite
  await knex.schema.alterTable('plate_char_substitutions', (t) => {
    t.bigInteger('site_id').nullable().references('id').inTable('sites');
  });
  await knex('plate_char_substitutions').update({ site_id: 1 });
  await knex.raw('ALTER TABLE plate_char_substitutions ALTER COLUMN site_id SET NOT NULL');
  await knex.raw('CREATE INDEX plate_char_substitutions_site_id_idx ON plate_char_substitutions(site_id)');
  await knex.raw('ALTER TABLE plate_char_substitutions DROP CONSTRAINT IF EXISTS plate_char_substitutions_from_char_to_char_unique');
  await knex.raw('ALTER TABLE plate_char_substitutions ADD CONSTRAINT plate_char_substitutions_site_from_to_uniq UNIQUE (site_id, from_char, to_char)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  // plate_char_substitutions
  await knex.raw('ALTER TABLE plate_char_substitutions DROP CONSTRAINT IF EXISTS plate_char_substitutions_site_from_to_uniq');
  await knex.raw('ALTER TABLE plate_char_substitutions ADD CONSTRAINT plate_char_substitutions_from_char_to_char_unique UNIQUE (from_char, to_char)');
  await knex.raw('DROP INDEX IF EXISTS plate_char_substitutions_site_id_idx');
  await knex.schema.alterTable('plate_char_substitutions', (t) => t.dropColumn('site_id'));

  // plate_learnings
  await knex.raw('DROP INDEX IF EXISTS plate_learnings_site_signature_idx');
  await knex.raw('CREATE INDEX plate_learnings_signature_idx ON plate_learnings(normalize_signature)');
  await knex.raw('ALTER TABLE plate_learnings DROP CONSTRAINT IF EXISTS plate_learnings_site_ocr_raw_uniq');
  await knex.raw('ALTER TABLE plate_learnings ADD CONSTRAINT plate_learnings_ocr_raw_unique UNIQUE (ocr_raw)');
  await knex.raw('DROP INDEX IF EXISTS plate_learnings_site_id_idx');
  await knex.schema.alterTable('plate_learnings', (t) => t.dropColumn('site_id'));

  // araclar
  await knex.raw('DROP INDEX IF EXISTS araclar_site_plaka_aktif_uniq');
  await knex.raw('CREATE UNIQUE INDEX araclar_plaka_aktif_uniq ON araclar(plaka) WHERE aktif = true');
  await knex.raw('DROP INDEX IF EXISTS araclar_site_id_idx');
  await knex.schema.alterTable('araclar', (t) => t.dropColumn('site_id'));

  // daireler
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_site_daire_no_uniq');
  await knex.raw('ALTER TABLE daireler ADD CONSTRAINT daireler_daire_no_unique UNIQUE (daire_no)');

  // basit tablolar
  for (const table of [...SIMPLE_TABLES].reverse()) {
    await knex.raw(`DROP INDEX IF EXISTS ${table}_site_id_idx`);
    await knex.schema.alterTable(table, (t) => t.dropColumn('site_id'));
  }
};
