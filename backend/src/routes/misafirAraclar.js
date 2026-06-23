const express = require('express');
const db = require('../db');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { writeAudit } = require('../middleware/audit');
const { isValidPlakaSerbest, normalizePlaka } = require('../utils/validators');
const { normalizeMisafirZaman, dayjs, TR_TZ } = require('../utils/timezone');

const router = express.Router();

// İş kuralı: bir daireye GÜNDE (TR takvim günü) en fazla bu kadar misafir
// kaydı oluşturulabilir. Suistimal/yanlışlıkla seri kayıt frenidir; sayım
// olusturma_zamani (kaydın atıldığı an) üzerinden yapılır, baslangic/bitis
// değil — "kaç kayıt atıldı" sorusunun doğru cevabı odur.
const MISAFIR_GUNLUK_KOTA_DAIRE = 200;

/**
 * Bugün (TR) bu daireye atılmış misafir kaydı sayısı kotayı doldurdu mu?
 * @returns {Promise<{asildi: boolean, mevcut: number}>}
 */
async function gunlukKotaDurumu(siteId, daireId) {
  const bugunTR = dayjs().tz(TR_TZ).format('YYYY-MM-DD');
  const gunBasi = normalizeMisafirZaman(bugunTR, false);
  const gunSonu = normalizeMisafirZaman(bugunTR, true);
  const row = await db('misafir_araclar')
    .where({ daire_id: daireId, site_id: siteId })
    .andWhere('olusturma_zamani', '>=', gunBasi)
    .andWhere('olusturma_zamani', '<=', gunSonu)
    .count('* as c')
    .first();
  const mevcut = parseInt(row.c, 10) || 0;
  return { asildi: mevcut >= MISAFIR_GUNLUK_KOTA_DAIRE, mevcut };
}

const kotaMesaji = `Bu daire için bugün en fazla ${MISAFIR_GUNLUK_KOTA_DAIRE} misafir kaydı oluşturulabilir.`;

// Misafir oluşturma (POST /, /hizli) bilinçli olarak güvenlik rolüne de açık
// (saha operasyon tercihi) — sadece DELETE site_yonetici ister. Tüm mutasyonlar
// askıya alınmış (suspended) abonelikte requireActiveSubscription ile bloke olur.
router.use(authRequired, requireScopedSite, requireActiveSubscription);

router.get('/', async (req, res) => {
  const { tarih } = req.query;
  let qb = db('misafir_araclar')
    .join('daireler', 'misafir_araclar.daire_id', 'daireler.id')
    .where('misafir_araclar.site_id', req.scopedSiteId)
    .select(
      'misafir_araclar.*',
      'daireler.daire_no',
      'daireler.sahip_ad'
    );
  if (tarih) {
    // O gün içinde herhangi bir anda aktif olan misafirler:
    //   baslangic_tarihi <= gün sonu  AND  bitis_tarihi >= gün başı
    const gunBasi = normalizeMisafirZaman(tarih, false);
    const gunSonu = normalizeMisafirZaman(tarih, true);
    qb = qb.andWhere('baslangic_tarihi', '<=', gunSonu).andWhere('bitis_tarihi', '>=', gunBasi);
  }
  const list = await qb.orderBy('baslangic_tarihi', 'desc');
  res.json({ misafir_araclar: list });
});

router.post('/', async (req, res) => {
  const { daire_id, plaka, baslangic_tarihi, bitis_tarihi, aciklama } = req.body || {};
  if (!daire_id) return res.status(400).json({ error: 'daire_id zorunlu.' });
  const p = normalizePlaka(plaka);
  if (!isValidPlakaSerbest(p)) return res.status(400).json({ error: 'Plaka formatı geçersiz.' });
  if (!baslangic_tarihi || !bitis_tarihi) {
    return res.status(400).json({ error: 'Başlangıç ve bitiş tarihi zorunlu.' });
  }
  const baslangic = normalizeMisafirZaman(baslangic_tarihi, false);
  const bitis = normalizeMisafirZaman(bitis_tarihi, true);
  if (!baslangic || !bitis) {
    return res.status(400).json({ error: 'Tarih/saat formatı geçersiz.' });
  }
  if (new Date(bitis) < new Date(baslangic)) {
    return res.status(400).json({ error: 'Bitiş başlangıçtan önce olamaz.' });
  }
  const daire = await db('daireler')
    .where({ id: daire_id, site_id: req.scopedSiteId, aktif: true })
    .first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });

  const kota = await gunlukKotaDurumu(req.scopedSiteId, daire_id);
  if (kota.asildi) return res.status(429).json({ error: kotaMesaji, kota: MISAFIR_GUNLUK_KOTA_DAIRE, mevcut: kota.mevcut });

  const [created] = await db('misafir_araclar').insert({
    daire_id, plaka: p, baslangic_tarihi: baslangic, bitis_tarihi: bitis,
    aciklama: aciklama || null,
    ekleyen_user_id: req.user.id,
    site_id: req.scopedSiteId,
  }).returning('*');

  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'olustur',
    tablo_adi: 'misafir_araclar',
    kayit_id: created.id,
    yeni_deger: created,
    ip_adres: req.ip,
  });
  res.status(201).json({ misafir: created });
});

// Hızlı misafir: Kontrol ekranındaki kayıtsız bir aracı, misafir ekranına
// gitmeden tek hamlede bir daireye misafir yapar. Görevli yalnız daire_no girer.
// Giriş (baslangic) = kaydın yükleme saati; Çıkış (bitis) = o günün (TR) 23:59.
// NOT (edge): kayıt gece yarısından sonra (00:00-08:00) girilmişse "o gün" =
// takvim günü alınır; operasyon günü (ceteleGunuTR) bir önceki güne düşmüş
// olabilir → bu nadir durumda kontrol listesindeki rozet hemen "misafir"e
// dönmeyebilir (misafir kaydı yine doğru oluşur). İş oturunca revize.
router.post('/hizli', async (req, res) => {
  const { kontrol_id, daire_no } = req.body || {};
  if (!kontrol_id) return res.status(400).json({ error: 'kontrol_id zorunlu.' });
  const dno = String(daire_no || '').trim().toUpperCase();
  if (!dno) return res.status(400).json({ error: 'Daire no zorunlu.' });

  const kontrol = await db('gunluk_kontroller')
    .where({ id: kontrol_id, site_id: req.scopedSiteId })
    .first();
  if (!kontrol) return res.status(404).json({ error: 'Kontrol kaydı bulunamadı.' });
  const p = normalizePlaka(kontrol.plaka);
  if (!isValidPlakaSerbest(p)) return res.status(400).json({ error: 'Plaka formatı geçersiz.' });

  const daire = await db('daireler')
    .where({ daire_no: dno, site_id: req.scopedSiteId, aktif: true })
    .first();
  if (!daire) return res.status(404).json({ error: `Daire bulunamadı: ${dno}` });

  const kota = await gunlukKotaDurumu(req.scopedSiteId, daire.id);
  if (kota.asildi) return res.status(429).json({ error: kotaMesaji, kota: MISAFIR_GUNLUK_KOTA_DAIRE, mevcut: kota.mevcut });

  const baslangic = dayjs(kontrol.yukleme_zamani).toISOString();
  const gunTR = dayjs(kontrol.yukleme_zamani).tz(TR_TZ).format('YYYY-MM-DD');
  const bitis = normalizeMisafirZaman(gunTR, true); // o günün 23:59:59 (TR)

  const [created] = await db('misafir_araclar').insert({
    daire_id: daire.id,
    plaka: p,
    baslangic_tarihi: baslangic,
    bitis_tarihi: bitis,
    aciklama: 'Kontrol ekranından hızlı misafir',
    ekleyen_user_id: req.user.id,
    site_id: req.scopedSiteId,
  }).returning('*');

  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'olustur',
    tablo_adi: 'misafir_araclar',
    kayit_id: created.id,
    yeni_deger: created,
    ip_adres: req.ip,
  });
  res.status(201).json({ misafir: created, daire_no: daire.daire_no });
});

router.delete('/:id', requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('misafir_araclar')
    .where({ id, site_id: req.scopedSiteId })
    .first();
  if (!eski) return res.status(404).json({ error: 'Misafir kayıt bulunamadı.' });
  await db('misafir_araclar')
    .where({ id, site_id: req.scopedSiteId })
    .delete();
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'sil',
    tablo_adi: 'misafir_araclar',
    kayit_id: id,
    eski_deger: eski,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

module.exports = router;
