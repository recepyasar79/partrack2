require('dotenv').config({ path: '../../.env' });

const db = require('../db');
const { gonderBirIhlal } = require('../routes/bildirimler');

const MAX_DENEME = 3;

async function main() {
  console.log('[bildirimRetry] Beklemede bildirimleri retry ediliyor.');

  const bekleyen = await db('bildirimler')
    .where('gonderim_durumu', 'beklemede')
    .where('deneme_sayisi', '<', MAX_DENEME)
    .select('id', 'ihlal_id', 'deneme_sayisi');

  console.log(`[bildirimRetry] ${bekleyen.length} bildirim bulundu.`);

  let basari = 0;
  let hata = 0;
  for (const b of bekleyen) {
    try {
      const r = await gonderBirIhlal(b.ihlal_id, null, 'cron');
      if (r.ok) basari++;
      else hata++;
    } catch (err) {
      console.warn(`[bildirimRetry] hata ihlal_id=${b.ihlal_id}: ${err.message}`);
      hata++;
    }
  }

  console.log(`[bildirimRetry] Sonuç: ${basari} başarılı, ${hata} hata.`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[bildirimRetry] hata:', err);
  process.exit(1);
});
