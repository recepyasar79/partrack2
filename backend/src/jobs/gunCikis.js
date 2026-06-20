require('dotenv').config({ path: '../../.env' });

const db = require('../db');
const { autoCloseGecmisOturumlar } = require('../utils/oturum');

// Günlük cron: geçmiş operasyon gününe ait açık kalan park oturumlarını
// mantıksal sabah-08:00 çıkışıyla kapatır (giriş/çıkış logu eksik kalmasın).
// Board "içeride" sayımı zaten operasyon günü filtresiyle sabah sıfırlanır;
// bu job yalnız log bütünlüğü içindir → cron'un tam saati önemli değil.
async function main() {
  const kapatilan = await autoCloseGecmisOturumlar(null);
  console.log(`[gunCikis] ${kapatilan} açık oturum mantıksal 08:00 çıkışıyla kapatıldı.`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[gunCikis] hata:', err);
  process.exit(1);
});
