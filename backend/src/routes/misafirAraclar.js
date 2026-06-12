const express = require('express');
const db = require('../db');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { isValidPlakaSerbest, normalizePlaka } = require('../utils/validators');
const { normalizeMisafirZaman } = require('../utils/timezone');

const router = express.Router();
router.use(authRequired, requireScopedSite);

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
