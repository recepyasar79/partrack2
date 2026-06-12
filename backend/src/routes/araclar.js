const express = require('express');
const db = require('../db');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { isValidPlakaSerbest, normalizePlaka } = require('../utils/validators');

const router = express.Router();

router.use(authRequired, requireScopedSite);

router.get('/', async (req, res) => {
  const { blok, q } = req.query;
  let qb = db('araclar')
    .join('daireler', 'araclar.daire_id', 'daireler.id')
    .where('araclar.site_id', req.scopedSiteId)
    .andWhere('araclar.aktif', true)
    .andWhere('daireler.aktif', true)
    .select(
      'araclar.id',
      'araclar.plaka',
      'araclar.kayit_zamani',
      'daireler.id as daire_id',
      'daireler.daire_no',
      'daireler.sahip_ad',
      'daireler.sahip_tel',
      'daireler.blok'
    );
  if (blok && /^[A-D]$/.test(blok)) qb = qb.where('daireler.blok', blok);
  if (q) {
    qb = qb.where(function () {
      this.where('araclar.plaka', 'ilike', `%${q}%`)
        .orWhere('daireler.daire_no', 'ilike', `%${q}%`)
        .orWhere('daireler.sahip_ad', 'ilike', `%${q}%`);
    });
  }
  const araclar = await qb.orderBy('daireler.blok').orderBy('daireler.sira_no').orderBy('araclar.plaka');
  res.json({ araclar });
});

router.get('/daire/:daire_id', async (req, res) => {
  const daire_id = parseInt(req.params.daire_id, 10);
  const araclar = await db('araclar')
    .where({ daire_id, site_id: req.scopedSiteId, aktif: true })
    .orderBy('plaka');
  res.json({ araclar });
});

router.post('/', requireSiteAdmin, async (req, res) => {
  const { daire_id, plaka } = req.body || {};
  if (!daire_id) return res.status(400).json({ error: 'daire_id zorunlu.' });
  const p = normalizePlaka(plaka);
  if (!isValidPlakaSerbest(p)) return res.status(400).json({ error: 'Plaka formatı geçersiz.' });

  const daire = await db('daireler')
    .where({ id: daire_id, site_id: req.scopedSiteId, aktif: true })
    .first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });

  // Plaka UNIQUE artık (site_id, plaka) — aynı plaka farklı site'de OK
  const conflict = await db('araclar')
    .where({ plaka: p, site_id: req.scopedSiteId, aktif: true })
    .first();
  if (conflict) {
    return res.status(409).json({
      error: 'Bu plaka başka bir aktif daireye kayıtlı.',
      mevcut_daire_id: conflict.daire_id,
    });
  }

  const [created] = await db('araclar')
    .insert({ daire_id, plaka: p, aktif: true, site_id: req.scopedSiteId })
    .returning('*');
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'olustur',
    tablo_adi: 'araclar',
    kayit_id: created.id,
    yeni_deger: created,
    ip_adres: req.ip,
  });
  res.status(201).json({ arac: created });
});

router.delete('/:id', requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('araclar').where({ id, site_id: req.scopedSiteId }).first();
  if (!eski) return res.status(404).json({ error: 'Araç bulunamadı.' });
  await db('araclar')
    .where({ id, site_id: req.scopedSiteId })
    .update({ aktif: false, silinme_zamani: db.fn.now() });
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'sil',
    tablo_adi: 'araclar',
    kayit_id: id,
    eski_deger: eski,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

module.exports = router;
