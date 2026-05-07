const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { isValidPlaka, normalizePlaka } = require('../utils/validators');
const { normalizeMisafirZaman } = require('../utils/timezone');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const { tarih } = req.query;
  let qb = db('misafir_araclar')
    .join('daireler', 'misafir_araclar.daire_id', 'daireler.id')
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
    qb = qb.where('baslangic_tarihi', '<=', gunSonu).andWhere('bitis_tarihi', '>=', gunBasi);
  }
  const list = await qb.orderBy('baslangic_tarihi', 'desc');
  res.json({ misafir_araclar: list });
});

router.post('/', authRequired, async (req, res) => {
  const { daire_id, plaka, baslangic_tarihi, bitis_tarihi, aciklama } = req.body || {};
  if (!daire_id) return res.status(400).json({ error: 'daire_id zorunlu.' });
  const p = normalizePlaka(plaka);
  if (!isValidPlaka(p)) return res.status(400).json({ error: 'Plaka formatı geçersiz.' });
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
  const daire = await db('daireler').where({ id: daire_id, aktif: true }).first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });

  const [created] = await db('misafir_araclar').insert({
    daire_id, plaka: p, baslangic_tarihi: baslangic, bitis_tarihi: bitis,
    aciklama: aciklama || null,
    ekleyen_user_id: req.user.id,
  }).returning('*');

  await writeAudit({
    user_id: req.user.id,
    eylem: 'olustur',
    tablo_adi: 'misafir_araclar',
    kayit_id: created.id,
    yeni_deger: created,
    ip_adres: req.ip,
  });
  res.status(201).json({ misafir: created });
});

router.delete('/:id', authRequired, requireRole('yonetici'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('misafir_araclar').where({ id }).first();
  if (!eski) return res.status(404).json({ error: 'Misafir kayıt bulunamadı.' });
  await db('misafir_araclar').where({ id }).delete();
  await writeAudit({
    user_id: req.user.id,
    eylem: 'sil',
    tablo_adi: 'misafir_araclar',
    kayit_id: id,
    eski_deger: eski,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

module.exports = router;
