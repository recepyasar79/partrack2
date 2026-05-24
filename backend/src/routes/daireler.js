const express = require('express');
const db = require('../db');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { isValidDaireNo, isValidTelefon, parseDaireNo } = require('../utils/validators');

const router = express.Router();

// Tüm endpoint'ler authRequired + requireScopedSite ile başlar — site_id
// zorunlu. Site-bağlı user'lar otomatik kendi site'sini görür, superadmin
// '?siteId=N' parametresiyle başka site'ye geçiş yapar.
router.use(authRequired, requireScopedSite);

router.get('/', async (req, res) => {
  const { blok, q, includeInactive } = req.query;
  let qb = db('daireler').where({ site_id: req.scopedSiteId });
  if (!includeInactive) qb = qb.where('aktif', true);
  if (blok && /^[A-D]$/.test(blok)) qb = qb.where('blok', blok);
  if (q) {
    qb = qb.where(function () {
      this.where('daire_no', 'ilike', `%${q}%`)
        .orWhere('sahip_ad', 'ilike', `%${q}%`)
        .orWhere('sahip_tel', 'ilike', `%${q}%`);
    });
  }
  const daireler = await qb.orderBy('blok').orderBy('sira_no');
  res.json({ daireler });
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const daire = await db('daireler').where({ id, site_id: req.scopedSiteId }).first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });
  const araclar = await db('araclar')
    .where({ daire_id: id, site_id: req.scopedSiteId, aktif: true });
  res.json({ daire, araclar });
});

router.post('/', requireSiteAdmin, async (req, res) => {
  const { daire_no, sahip_ad, sahip_tel, kvkk_riza, bildirim_opt_in } = req.body || {};
  if (!isValidDaireNo(daire_no)) return res.status(400).json({ error: 'Geçersiz daire numarası.' });
  if (!sahip_ad || sahip_ad.length < 2) return res.status(400).json({ error: 'Sahip adı zorunlu.' });
  if (!isValidTelefon(sahip_tel)) return res.status(400).json({ error: 'Telefon formatı geçersiz (05XXXXXXXXX).' });
  if (!kvkk_riza) return res.status(400).json({ error: 'KVKK rızası zorunlu.' });

  // UNIQUE artık (site_id, daire_no) composite — aynı daire_no farklı site'de OK
  const existing = await db('daireler')
    .where({ daire_no, site_id: req.scopedSiteId })
    .first();
  if (existing && existing.aktif) {
    return res.status(409).json({ error: 'Bu daire numarası zaten kayıtlı.' });
  }
  const { blok, sira_no } = parseDaireNo(daire_no);

  let created;
  if (existing && !existing.aktif) {
    [created] = await db('daireler').where({ id: existing.id }).update({
      sahip_ad,
      sahip_tel,
      kvkk_riza: !!kvkk_riza,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: !!bildirim_opt_in,
      aktif: true,
      silinme_zamani: null,
    }).returning('*');
  } else {
    [created] = await db('daireler').insert({
      daire_no, blok, sira_no, sahip_ad, sahip_tel,
      kvkk_riza: !!kvkk_riza,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: !!bildirim_opt_in,
      aktif: true,
      site_id: req.scopedSiteId,
    }).returning('*');
  }

  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'olustur',
    tablo_adi: 'daireler',
    kayit_id: created.id,
    yeni_deger: created,
    ip_adres: req.ip,
  });
  res.status(201).json({ daire: created });
});

router.put('/:id', requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('daireler').where({ id, site_id: req.scopedSiteId }).first();
  if (!eski) return res.status(404).json({ error: 'Daire bulunamadı.' });
  const { sahip_ad, sahip_tel, bildirim_opt_in, kvkk_riza } = req.body || {};
  const update = {};
  if (sahip_ad !== undefined) update.sahip_ad = sahip_ad;
  if (sahip_tel !== undefined) {
    if (!isValidTelefon(sahip_tel)) return res.status(400).json({ error: 'Telefon formatı geçersiz.' });
    update.sahip_tel = sahip_tel;
  }
  if (bildirim_opt_in !== undefined) update.bildirim_opt_in = !!bildirim_opt_in;
  if (kvkk_riza !== undefined) {
    update.kvkk_riza = !!kvkk_riza;
    if (kvkk_riza) update.kvkk_riza_tarihi = db.fn.now();
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });

  const [updated] = await db('daireler')
    .where({ id, site_id: req.scopedSiteId })
    .update(update)
    .returning('*');
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'guncelle',
    tablo_adi: 'daireler',
    kayit_id: id,
    eski_deger: eski,
    yeni_deger: updated,
    ip_adres: req.ip,
  });
  res.json({ daire: updated });
});

router.delete('/:id', requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('daireler').where({ id, site_id: req.scopedSiteId }).first();
  if (!eski) return res.status(404).json({ error: 'Daire bulunamadı.' });
  await db.transaction(async (trx) => {
    await trx('daireler')
      .where({ id, site_id: req.scopedSiteId })
      .update({ aktif: false, silinme_zamani: trx.fn.now() });
    await trx('araclar')
      .where({ daire_id: id, site_id: req.scopedSiteId })
      .update({ aktif: false, silinme_zamani: trx.fn.now() });
  });
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'sil',
    tablo_adi: 'daireler',
    kayit_id: id,
    eski_deger: eski,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

router.post('/:id/sahip-degistir', requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { yeni_sahip_ad, yeni_sahip_tel, kvkk_riza, bildirim_opt_in } = req.body || {};
  if (!yeni_sahip_ad || !isValidTelefon(yeni_sahip_tel)) {
    return res.status(400).json({ error: 'Geçersiz yeni sahip bilgileri.' });
  }
  if (!kvkk_riza) return res.status(400).json({ error: 'Yeni sahip için KVKK rızası zorunlu.' });

  const daire = await db('daireler').where({ id, site_id: req.scopedSiteId }).first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });

  const result = await db.transaction(async (trx) => {
    await trx('daire_sahip_tarihce').insert({
      daire_id: id,
      site_id: req.scopedSiteId,
      sahip_ad: daire.sahip_ad,
      sahip_tel: daire.sahip_tel,
      baslangic_tarihi: daire.kayit_zamani,
      bitis_tarihi: trx.fn.now(),
    });
    const [updated] = await trx('daireler')
      .where({ id, site_id: req.scopedSiteId })
      .update({
        sahip_ad: yeni_sahip_ad,
        sahip_tel: yeni_sahip_tel,
        kvkk_riza: !!kvkk_riza,
        kvkk_riza_tarihi: trx.fn.now(),
        bildirim_opt_in: !!bildirim_opt_in,
      })
      .returning('*');
    return updated;
  });

  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'sahip_degistir',
    tablo_adi: 'daireler',
    kayit_id: id,
    eski_deger: { sahip_ad: daire.sahip_ad, sahip_tel: daire.sahip_tel },
    yeni_deger: { sahip_ad: yeni_sahip_ad, sahip_tel: yeni_sahip_tel },
    ip_adres: req.ip,
  });
  res.json({ daire: result });
});

router.post('/bulk-import', requireSiteAdmin, async (req, res) => {
  const { satirlar } = req.body || {};
  if (!Array.isArray(satirlar) || !satirlar.length) {
    return res.status(400).json({ error: 'Satır listesi zorunlu.' });
  }
  const eklenenler = [];
  const hatalar = [];

  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i];
    try {
      if (!isValidDaireNo(s.daire_no)) throw new Error('Geçersiz daire_no');
      if (!s.sahip_ad) throw new Error('sahip_ad eksik');
      if (!isValidTelefon(s.sahip_tel)) throw new Error('Geçersiz telefon');
      const { blok, sira_no } = parseDaireNo(s.daire_no);
      const exist = await db('daireler')
        .where({ daire_no: s.daire_no, site_id: req.scopedSiteId, aktif: true })
        .first();
      if (exist) throw new Error('Daire zaten kayıtlı');
      const [created] = await db('daireler').insert({
        daire_no: s.daire_no, blok, sira_no,
        sahip_ad: s.sahip_ad, sahip_tel: s.sahip_tel,
        kvkk_riza: !!s.kvkk_riza,
        kvkk_riza_tarihi: s.kvkk_riza ? db.fn.now() : null,
        bildirim_opt_in: !!s.bildirim_opt_in,
        aktif: true,
        site_id: req.scopedSiteId,
      }).returning(['id', 'daire_no']);
      eklenenler.push(created);
    } catch (err) {
      hatalar.push({ satir: i + 1, daire_no: s.daire_no, hata: err.message });
    }
  }
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'bulk_import',
    tablo_adi: 'daireler',
    yeni_deger: { eklenen: eklenenler.length, hata: hatalar.length },
    ip_adres: req.ip,
  });
  res.status(201).json({ eklenenler, hatalar });
});

module.exports = router;
