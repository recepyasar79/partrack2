const express = require('express');
const db = require('../db');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { writeAudit } = require('../middleware/audit');
const { isValidTelefon } = require('../utils/validators');
const { isValidDaireInSite, parseDaireNoFlexible } = require('../utils/siteYapisi');
const { getEffectiveLimits, isLimitReached } = require('../utils/planLimits');

const router = express.Router();

/**
 * 2. araç hakkı kotası dolu mu? Site genelinde aktif + ikinci_arac_izinli
 * daire sayısı kapasiteye ulaştıysa true. `haricId` verilirse (güncellemede
 * kendi satırını sayma) o daire hariç tutulur.
 *
 * @returns {Promise<{dolu: boolean, kapasite: number, mevcut: number}>}
 */
async function ikinciAracKotaDurumu(siteId, kapasite, haricId = null) {
  let qb = db('daireler').where({ site_id: siteId, aktif: true, ikinci_arac_izinli: true });
  if (haricId != null) qb = qb.whereNot('id', haricId);
  const row = await qb.count('* as c').first();
  const mevcut = parseInt(row.c, 10) || 0;
  return { dolu: mevcut >= (kapasite || 0), kapasite: kapasite || 0, mevcut };
}

const ikinciAracKotaMesaji = (kapasite) =>
  `Sitede en fazla ${kapasite} daire için ikinci araç izni verebilirsiniz.`;

// Tüm endpoint'ler authRequired + requireScopedSite ile başlar — site_id
// zorunlu. Site-bağlı user'lar otomatik kendi site'sini görür, superadmin
// '?siteId=N' parametresiyle başka site'ye geçiş yapar.
router.use(authRequired, requireScopedSite, requireActiveSubscription);

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

/**
 * GET /api/daireler/:id/sahip-tarihce (Faz Ü4)
 *
 * Daire'nin eski sahipleri — bitis_tarihi sırasıyla. Tüm site rolleri
 * görebilir (gizlilik açısından sahip telefonu maskelenir; site_yonetici
 * audit için tam görür).
 */
router.get('/:id/sahip-tarihce', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const daire = await db('daireler').where({ id, site_id: req.scopedSiteId }).first();
  if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });
  const tarihce = await db('daire_sahip_tarihce')
    .where({ daire_id: id, site_id: req.scopedSiteId })
    .orderBy('bitis_tarihi', 'desc');

  const maskTel = req.user.rol !== 'site_yonetici';
  const safe = tarihce.map((r) => ({
    ...r,
    sahip_tel: maskTel ? r.sahip_tel.replace(/(\d{3})\d{4}(\d{2})$/, '$1****$2') : r.sahip_tel,
  }));
  res.json({ tarihce: safe });
});

router.post('/', requireSiteAdmin, async (req, res) => {
  const { daire_no, sahip_ad, sahip_tel, kvkk_riza, bildirim_opt_in, ikinci_arac_izinli } = req.body || {};
  if (!sahip_ad || sahip_ad.length < 2) return res.status(400).json({ error: 'Sahip adı zorunlu.' });
  if (!isValidTelefon(sahip_tel)) return res.status(400).json({ error: 'Telefon formatı geçersiz (05XXXXXXXXX).' });
  if (!kvkk_riza) return res.status(400).json({ error: 'KVKK rızası zorunlu.' });

  // Site'nin blok_yapisi'na göre daire_no'yu doğrula. Mevcut hardcoded
  // A-D × 34 yerine, her site kendi blok/daire sayısını sites.blok_yapisi
  // JSONB kolonunda tutar (Ü1.11).
  const site = await db('sites').where({ id: req.scopedSiteId }).first();
  if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });
  const blokYapisi = site.blok_yapisi || [];
  const parsed = parseDaireNoFlexible(daire_no);
  if (!parsed || !isValidDaireInSite(parsed, blokYapisi)) {
    return res.status(400).json({
      error: 'Geçersiz daire numarası — site blok yapısına uygun değil.',
    });
  }
  const { blok, sira_no } = parsed;

  // UNIQUE artık (site_id, daire_no) composite — aynı daire_no farklı site'de OK
  const existing = await db('daireler')
    .where({ daire_no, site_id: req.scopedSiteId })
    .first();
  if (existing && existing.aktif) {
    return res.status(409).json({ error: 'Bu daire numarası zaten kayıtlı.' });
  }

  // Plan limit kontrolü (Ü2). YENİ daire eklemesi limit'i aşacaksa 402.
  // Reactivate (existing && !aktif) limit'i artırmaz, sadece insert yolu sayar.
  if (!existing) {
    const limits = getEffectiveLimits(site);
    const aktifCount = await db('daireler')
      .where({ site_id: req.scopedSiteId, aktif: true })
      .count('* as c')
      .first();
    const current = parseInt(aktifCount.c, 10) || 0;
    if (isLimitReached(limits.daire_max, current)) {
      return res.status(402).json({
        error: `Plan limiti doldu (${current}/${limits.daire_max} daire). Plan yükseltmek için site sahibinizle iletişime geçin.`,
        limit: 'daire_max',
        current,
        max: limits.daire_max,
      });
    }
  }

  // 2. araç hakkı kotası: işaretliyse site kapasitesini aşmamalı. Reactivate
  // yolunda da yeni bir aktif izinli satır eklendiği için aynı kontrol geçerli.
  if (ikinci_arac_izinli) {
    const kota = await ikinciAracKotaDurumu(req.scopedSiteId, site.ikinci_arac_kapasitesi);
    if (kota.dolu) {
      return res.status(409).json({ error: ikinciAracKotaMesaji(kota.kapasite) });
    }
  }

  let created;
  if (existing && !existing.aktif) {
    [created] = await db('daireler').where({ id: existing.id }).update({
      sahip_ad,
      sahip_tel,
      kvkk_riza: !!kvkk_riza,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: !!bildirim_opt_in,
      ikinci_arac_izinli: !!ikinci_arac_izinli,
      aktif: true,
      silinme_zamani: null,
    }).returning('*');
  } else {
    [created] = await db('daireler').insert({
      daire_no, blok, sira_no, sahip_ad, sahip_tel,
      kvkk_riza: !!kvkk_riza,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: !!bildirim_opt_in,
      ikinci_arac_izinli: !!ikinci_arac_izinli,
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
  const { sahip_ad, sahip_tel, bildirim_opt_in, kvkk_riza, ikinci_arac_izinli } = req.body || {};
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
  if (ikinci_arac_izinli !== undefined) {
    // false → true geçişinde site kotasını aşmamalı. Kendi satırını sayma
    // (zaten izinliyken başka alan güncellenmesi kotayı bozmamalı).
    if (ikinci_arac_izinli && !eski.ikinci_arac_izinli) {
      const site = await db('sites').where({ id: req.scopedSiteId }).first();
      const kota = await ikinciAracKotaDurumu(req.scopedSiteId, site?.ikinci_arac_kapasitesi, id);
      if (kota.dolu) {
        return res.status(409).json({ error: ikinciAracKotaMesaji(kota.kapasite) });
      }
    }
    update.ikinci_arac_izinli = !!ikinci_arac_izinli;
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

  // Bulk-import için site'nin blok_yapisi'sını tek seferde çek
  const site = await db('sites').where({ id: req.scopedSiteId }).first();
  const blokYapisi = site?.blok_yapisi || [];

  // Plan limit kontrolü (Ü2) — tekil POST'taki kontrolün aynısı. Bulk-import
  // bunu atlarsa CSV ile limit bypass edilir. Mevcut sayıyı bir kez çekip
  // döngüde insert başına artırıyoruz; başarısız satırlar sayacı artırmaz.
  const limits = getEffectiveLimits(site);
  let aktifDaireSayisi = 0;
  if (limits.daire_max != null) {
    const aktifCount = await db('daireler')
      .where({ site_id: req.scopedSiteId, aktif: true })
      .count('* as c')
      .first();
    aktifDaireSayisi = parseInt(aktifCount.c, 10) || 0;
  }

  // 2. araç hakkı kotası — başlangıç sayımı + döngüde artan sayaç.
  const ikinciAracKapasite = site?.ikinci_arac_kapasitesi || 0;
  const izinliRow = await db('daireler')
    .where({ site_id: req.scopedSiteId, aktif: true, ikinci_arac_izinli: true })
    .count('* as c')
    .first();
  let ikinciAracSayisi = parseInt(izinliRow.c, 10) || 0;

  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i];
    try {
      if (isLimitReached(limits.daire_max, aktifDaireSayisi)) {
        throw new Error(`Plan limiti doldu (${aktifDaireSayisi}/${limits.daire_max} daire)`);
      }
      const parsed = parseDaireNoFlexible(s.daire_no);
      if (!parsed || !isValidDaireInSite(parsed, blokYapisi)) {
        throw new Error('Geçersiz daire_no (site yapısına uymuyor)');
      }
      const { blok, sira_no } = parsed;
      if (!s.sahip_ad) throw new Error('sahip_ad eksik');
      if (!isValidTelefon(s.sahip_tel)) throw new Error('Geçersiz telefon');
      const exist = await db('daireler')
        .where({ daire_no: s.daire_no, site_id: req.scopedSiteId, aktif: true })
        .first();
      if (exist) throw new Error('Daire zaten kayıtlı');
      const ikinciArac = ['true', '1', 'evet'].includes(String(s.ikinci_arac_izinli || '').toLowerCase()) || s.ikinci_arac_izinli === true;
      if (ikinciArac && ikinciAracSayisi >= ikinciAracKapasite) {
        throw new Error(ikinciAracKotaMesaji(ikinciAracKapasite));
      }
      const [created] = await db('daireler').insert({
        daire_no: s.daire_no, blok, sira_no,
        sahip_ad: s.sahip_ad, sahip_tel: s.sahip_tel,
        kvkk_riza: !!s.kvkk_riza,
        kvkk_riza_tarihi: s.kvkk_riza ? db.fn.now() : null,
        bildirim_opt_in: !!s.bildirim_opt_in,
        ikinci_arac_izinli: ikinciArac,
        aktif: true,
        site_id: req.scopedSiteId,
      }).returning(['id', 'daire_no']);
      eklenenler.push(created);
      aktifDaireSayisi += 1;
      if (ikinciArac) ikinciAracSayisi += 1;
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
