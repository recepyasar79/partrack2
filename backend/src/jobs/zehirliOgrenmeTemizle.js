require('dotenv').config({ path: '../../.env' });

const db = require('../db');

// Zehirli öğrenme temizliği.
//
// plate_learnings havuzunun invariant'ı: correct_plaka HER ZAMAN kayıtlı bir
// araç (araclar.aktif) ya da bugün geçerli bir misafir plakası olmalı. Bu
// invariant'ı bozan satır "zehirli"dir: OCR o ham metni okuyunca learned-exact
// ile kayıtsız bir plakaya snap edip gerçek kayıtlı plakayı kalıcı gölgeler.
//
// recordLearning (plateMatcher.js) artık yazarken bu şartı koşuyor, yani yeni
// zehir oluşmamalı. Ama bir plaka öğrenildikten SONRA araclar'dan silinir /
// pasifleşirse ya da misafir kaydı geçerlilik penceresinden çıkarsa, eski
// öğrenmesi geriye dönük zehirli hale gelir. Bu job o birikimi periyodik
// süpürür (savunma katmanı).
//
// ZEHIRLI_OGRENME_DRY_RUN=1 → silme, yalnız raporla (önce gör, sonra sil).

const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
const DRY_RUN = process.env.ZEHIRLI_OGRENME_DRY_RUN === '1';

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Öğrenme kaydı olan tüm site'ler — temizlik site bazında (kayıtlı plaka
  // kümesi site'ye özel; bir site'nin plakası diğerini etkilemez).
  const siteIds = await db('plate_learnings').distinct('site_id').pluck('site_id');

  let totalBad = 0;
  let totalDeleted = 0;

  for (const siteId of siteIds) {
    if (siteId == null) continue;

    const reg = new Set(
      (await db('araclar').where({ site_id: siteId, aktif: true }).select('plaka'))
        .map((r) => norm(r.plaka))
    );
    const guest = new Set(
      (await db('misafir_araclar')
        .where('site_id', siteId)
        .andWhere('baslangic_tarihi', '<=', today)
        .andWhere('bitis_tarihi', '>=', today)
        .select('plaka'))
        .map((r) => norm(r.plaka))
    );

    const learnings = await db('plate_learnings')
      .where('site_id', siteId)
      .select('id', 'ocr_raw', 'correct_plaka', 'confirm_count');

    const bad = learnings.filter((r) => {
      const c = norm(r.correct_plaka);
      return !reg.has(c) && !guest.has(c);
    });

    if (!bad.length) continue;
    totalBad += bad.length;

    console.log(
      `[zehirliOgrenmeTemizle] site ${siteId}: ${bad.length} zehirli öğrenme `
      + `(${learnings.length} toplam)${DRY_RUN ? ' — DRY RUN, silinmiyor' : ''}:`
    );
    for (const r of bad) {
      console.log(`  - ocr_raw=${r.ocr_raw} → correct=${r.correct_plaka} (id ${r.id}, confirm ${r.confirm_count})`);
    }

    if (!DRY_RUN) {
      const n = await db('plate_learnings').whereIn('id', bad.map((r) => r.id)).del();
      totalDeleted += n;
    }
  }

  console.log(
    `[zehirliOgrenmeTemizle] ${siteIds.length} site tarandı, ${totalBad} zehirli bulundu, `
    + `${DRY_RUN ? 0 : totalDeleted} silindi${DRY_RUN ? ' (dry run)' : ''}.`
  );
  await db.destroy();
}

main().catch((err) => {
  console.error('[zehirliOgrenmeTemizle] hata:', err);
  process.exit(1);
});
