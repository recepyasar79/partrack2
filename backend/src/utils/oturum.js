const db = require('../db');
const { ceteleGunuTR } = require('./timezone');

/**
 * Geçmiş operasyon gününe ait açık kalan park oturumlarını kapatır.
 *
 * Model: araç "Çıkış Yap" ile kapatılmadıysa cikis_zamani NULL kalır. Sabah
 * 08:00'de operasyon günü döner; o günün araçları "içeride" sayımından zaten
 * düşer (sorgular kontrol_tarihi = ceteleGunuTR ile filtreler). Burada LOG'un
 * eksik kalmaması için, kontrol_tarihi bugünün operasyon gününden ÖNCE olup
 * hâlâ açık oturumlara MANTIKSAL çıkış zamanı damgalanır: ertesi sabah 08:00
 * (TR). Böylece cron'un tam saati önemli değildir — damga zamanı satırın kendi
 * gününe göre hesaplanır, idempotenttir (bir kez kapanan tekrar yakalanmaz).
 *
 * @param {number|null} siteId - verilirse yalnız o site; null ise tüm siteler
 * @returns {Promise<number>} kapatılan oturum sayısı
 */
async function autoCloseGecmisOturumlar(siteId = null) {
  let qb = db('gunluk_kontroller')
    .whereNull('cikis_zamani')
    .where('kontrol_tarihi', '<', ceteleGunuTR());
  if (siteId != null) qb = qb.where('site_id', siteId);
  return qb.update({
    // date + int = date; date + time = timestamp(local); AT TIME ZONE → tz'li.
    cikis_zamani: db.raw(`((kontrol_tarihi + 1) + TIME '08:00') AT TIME ZONE 'Europe/Istanbul'`),
  });
}

module.exports = { autoCloseGecmisOturumlar };
