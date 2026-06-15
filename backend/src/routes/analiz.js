const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { detectViolations } = require('../utils/violations');
const { todayTR, normalizeMisafirZaman } = require('../utils/timezone');
const { normalizePlaka } = require('../utils/validators');

const router = express.Router();

router.use(authRequired, requireScopedSite);

const IHLAL_MESAJI =
  'Sayın {sahip}, {daire} numaralı dairenize tanımlı birden fazla araç ({plakalar}) site otoparkında tespit edildi. ' +
  'Lütfen en kısa sürede fazla olan aracı/araçları çıkartınız.';

router.post('/analiz-et', async (req, res, next) => {
  try {
    const tarih = req.body?.tarih || todayTR();
    const siteId = req.scopedSiteId;

    const kontroller = await db('gunluk_kontroller')
      .where({ kontrol_tarihi: tarih, site_id: siteId })
      .whereNotNull('plaka')
      .where('plaka', '!=', '');
    const plakalar = kontroller.map((k) => k.plaka);

    const aktifAraclar = await db('araclar')
      .join('daireler', 'araclar.daire_id', 'daireler.id')
      .where('araclar.site_id', siteId)
      .andWhere('araclar.aktif', true)
      .andWhere('daireler.aktif', true)
      .select(
        'araclar.plaka',
        'daireler.id as daire_id',
        'daireler.daire_no',
        'daireler.sahip_ad',
        'daireler.sahip_tel',
        'daireler.bildirim_opt_in'
      );
    const plakaToDaire = new Map();
    for (const a of aktifAraclar) plakaToDaire.set(normalizePlaka(a.plaka), a);

    // Akşam kontrol referansı: tarih + 20:00 TR. Body ile override edilebilir.
    const referansZaman =
      req.body?.referans_zaman || normalizeMisafirZaman(`${tarih}T20:00`, false);
    const misafirler = await db('misafir_araclar')
      .join('daireler', 'misafir_araclar.daire_id', 'daireler.id')
      .where('misafir_araclar.site_id', siteId)
      .andWhere('baslangic_tarihi', '<=', referansZaman)
      .andWhere('bitis_tarihi', '>=', referansZaman)
      .andWhere('daireler.aktif', true)
      .select(
        'misafir_araclar.plaka',
        'misafir_araclar.aciklama',
        'misafir_araclar.baslangic_tarihi',
        'misafir_araclar.bitis_tarihi',
        'misafir_araclar.olusturma_zamani',
        'daireler.id as daire_id',
        'daireler.daire_no',
        'daireler.sahip_ad',
        'daireler.sahip_tel',
        'daireler.bildirim_opt_in'
      );
    const misafirPlakaToDaire = new Map();
    for (const m of misafirler) misafirPlakaToDaire.set(normalizePlaka(m.plaka), m);

    const seenPlateSet = new Set();
    for (const raw of plakalar) {
      const np = normalizePlaka(raw);
      if (np) seenPlateSet.add(np);
    }
    const misafirGorulen = [];
    for (const m of misafirler) {
      const np = normalizePlaka(m.plaka);
      if (!seenPlateSet.has(np)) continue;
      misafirGorulen.push({
        plaka: np,
        daire_id: m.daire_id,
        daire_no: m.daire_no,
        sahip_ad: m.sahip_ad,
        aciklama: m.aciklama || '',
        baslangic_tarihi: m.baslangic_tarihi,
        bitis_tarihi: m.bitis_tarihi,
        olusturma_zamani: m.olusturma_zamani,
      });
    }

    const { ihlalYapanDaireler, kayitsizPlakalar } = detectViolations({
      plakalar,
      plakaToDaire,
      misafirPlakaToDaire,
    });

    const yeniIhlaller = [];
    const guncellenenler = [];

    await db.transaction(async (trx) => {
      for (const i of ihlalYapanDaireler) {
        const existing = await trx('ihlaller')
          .where({ kontrol_tarihi: tarih, daire_id: i.daire_id, site_id: siteId })
          .first();
        if (existing) {
          const eskiSet = new Set(existing.plaka_listesi || []);
          const yeniSet = new Set(i.plakalar);
          const same = eskiSet.size === yeniSet.size && [...eskiSet].every((p) => yeniSet.has(p));
          if (!same) {
            await trx('ihlaller')
              .where({ id: existing.id })
              .update({ plaka_listesi: JSON.stringify(i.plakalar) });
            guncellenenler.push({ ihlal_id: existing.id, daire_no: i.daire_no, plakalar: i.plakalar });
          }
        } else {
          const [created] = await trx('ihlaller')
            .insert({
              kontrol_tarihi: tarih,
              daire_id: i.daire_id,
              daire_no_snapshot: i.daire_no,
              plaka_listesi: JSON.stringify(i.plakalar),
              ihlal_tipi: 'coklu_arac',
              site_id: siteId,
            })
            .returning('*');
          yeniIhlaller.push({
            ihlal_id: created.id,
            daire_no: i.daire_no,
            sahip_ad: i.sahip_ad,
            sahip_tel: i.sahip_tel,
            bildirim_opt_in: i.bildirim_opt_in,
            plakalar: i.plakalar,
          });
        }
      }

      const existingKayitsiz = await trx('ihlaller')
        .where({ kontrol_tarihi: tarih, ihlal_tipi: 'kayitsiz', site_id: siteId })
        .whereNull('daire_id')
        .first();
      if (kayitsizPlakalar.length) {
        if (existingKayitsiz) {
          await trx('ihlaller')
            .where({ id: existingKayitsiz.id })
            .update({ plaka_listesi: JSON.stringify(kayitsizPlakalar) });
        } else {
          await trx('ihlaller').insert({
            kontrol_tarihi: tarih,
            daire_id: null,
            daire_no_snapshot: null,
            plaka_listesi: JSON.stringify(kayitsizPlakalar),
            ihlal_tipi: 'kayitsiz',
            site_id: siteId,
          });
        }
      } else if (existingKayitsiz) {
        await trx('ihlaller').where({ id: existingKayitsiz.id }).delete();
      }
    });

    await writeAudit({
      user_id: req.user.id,
      site_id: req.scopedSiteId,
      eylem: 'analiz_et',
      tablo_adi: 'ihlaller',
      yeni_deger: {
        tarih,
        ihlal_sayisi: ihlalYapanDaireler.length,
        kayitsiz_sayisi: kayitsizPlakalar.length,
      },
      ip_adres: req.ip,
    });

    res.json({
      tarih,
      ihlaller: ihlalYapanDaireler.map((i) => {
        const yeni = yeniIhlaller.find((y) => y.daire_no === i.daire_no);
        return {
          ...i,
          ihlal_id: yeni?.ihlal_id || null,
          yeni_eklendi: !!yeni,
        };
      }),
      kayitsiz_plakalar: kayitsizPlakalar,
      misafir_gorulen: misafirGorulen,
      yeni_ihlaller: yeniIhlaller,
      guncellenen_ihlaller: guncellenenler,
    });
  } catch (e) { next(e); }
});

router.get('/ihlaller', async (req, res, next) => {
  try {
    const { baslangic, bitis, daire_id, tipi } = req.query;
    let qb = db('ihlaller')
      .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
      .where('ihlaller.site_id', req.scopedSiteId)
      .select(
        'ihlaller.*',
        'daireler.sahip_ad',
        'daireler.sahip_tel',
        'daireler.bildirim_opt_in'
      );
    if (baslangic) qb = qb.where('ihlaller.kontrol_tarihi', '>=', baslangic);
    if (bitis) qb = qb.where('ihlaller.kontrol_tarihi', '<=', bitis);
    if (daire_id) qb = qb.where('ihlaller.daire_id', daire_id);
    if (tipi) qb = qb.where('ihlaller.ihlal_tipi', tipi);
    // Sınırsız liste zamanla büyür (her satırda JSONB plaka listesi) —
    // bildirimler'deki gibi üst sınır. ?limit ile düşürülebilir, 1000'i aşamaz.
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const ihlaller = await qb.orderBy('ihlaller.kontrol_tarihi', 'desc').limit(limit);
    res.json({ ihlaller });
  } catch (e) { next(e); }
});

router.get('/ihlaller/ozet', async (req, res, next) => {
  try {
    const { baslangic, bitis } = req.query;
    let qb = db('ihlaller')
      .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
      .where('ihlaller.site_id', req.scopedSiteId)
      .andWhere('ihlaller.ihlal_tipi', 'coklu_arac')
      .groupBy('daireler.daire_no', 'daireler.sahip_ad')
      .select(
        'daireler.daire_no',
        'daireler.sahip_ad',
        db.raw('count(*)::int as ihlal_sayisi'),
        db.raw('max(ihlaller.kontrol_tarihi) as son_ihlal')
      );
    if (baslangic) qb = qb.where('ihlaller.kontrol_tarihi', '>=', baslangic);
    if (bitis) qb = qb.where('ihlaller.kontrol_tarihi', '<=', bitis);
    const ozet = await qb.orderBy('ihlal_sayisi', 'desc');
    res.json({ ozet });
  } catch (e) { next(e); }
});

// --- Gece Çetelesi ---------------------------------------------------------
// Akşam kontrolü sonrası daire bazlı "içeride kaç araç" canlı sayacı.

/**
 * Verilen tarih için her dairenin içeride tespit edilen araç sayısını hesapla
 * (akşam tohumu). Mantık analiz-et ile aynı: bugün görülen farklı plakaları
 * kayıtlı araç ya da o an aktif misafir üzerinden daireye eşler, daire başına
 * say. Misafir eşleşmesi kayıtlıya göre önceliklidir (detectViolations ile
 * tutarlı). Kayıtsız plakalar hiçbir daireye sayılmaz.
 * @returns {Promise<Map<number, number>>} daire_id → araç sayısı
 */
async function dairBasinaIcerideSayisi(siteId, tarih) {
  const kontroller = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih, site_id: siteId })
    .whereNotNull('plaka')
    .where('plaka', '!=', '');
  const gorulen = new Set();
  for (const k of kontroller) {
    const p = normalizePlaka(k.plaka);
    if (p) gorulen.add(p);
  }
  if (!gorulen.size) return new Map();

  const aktifAraclar = await db('araclar')
    .where({ site_id: siteId, aktif: true })
    .select('plaka', 'daire_id');
  const plakaToDaire = new Map();
  for (const a of aktifAraclar) plakaToDaire.set(normalizePlaka(a.plaka), a.daire_id);

  const referansZaman = normalizeMisafirZaman(`${tarih}T20:00`, false);
  const misafirler = await db('misafir_araclar')
    .where('site_id', siteId)
    .andWhere('baslangic_tarihi', '<=', referansZaman)
    .andWhere('bitis_tarihi', '>=', referansZaman)
    .select('plaka', 'daire_id');
  const misafirToDaire = new Map();
  for (const m of misafirler) misafirToDaire.set(normalizePlaka(m.plaka), m.daire_id);

  const counts = new Map();
  for (const p of gorulen) {
    const daireId = misafirToDaire.has(p) ? misafirToDaire.get(p) : plakaToDaire.get(p);
    if (daireId == null) continue; // kayıtsız → sayılmaz
    counts.set(daireId, (counts.get(daireId) || 0) + 1);
  }
  return counts;
}

// Tüm aktif daireleri + o tarihteki gece çetelesi sayılarını döner. Tablo o
// tarih için ilk kez sorgulanıyorsa akşam tespitinden tohumlanır (yalnız bir
// kez; sonrası manuel +/- ile yönetilir). Eksik daireler COALESCE ile 0.
router.get('/gece-cetelesi', async (req, res, next) => {
  try {
    const tarih = req.query.tarih || todayTR();
    const siteId = req.scopedSiteId;

    const mevcut = await db('gece_cetelesi')
      .where({ site_id: siteId, tarih })
      .count('* as n')
      .first();
    if (parseInt(mevcut.n, 10) === 0) {
      const daireler = await db('daireler')
        .where({ site_id: siteId, aktif: true })
        .select('id');
      const counts = await dairBasinaIcerideSayisi(siteId, tarih);
      const tohum = daireler
        .map((d) => ({ site_id: siteId, daire_id: d.id, tarih, arac_sayisi: counts.get(d.id) || 0 }))
        .filter((r) => r.arac_sayisi > 0); // 0'lar COALESCE ile gelir, satıra gerek yok
      if (tohum.length) {
        await db('gece_cetelesi')
          .insert(tohum)
          .onConflict(['site_id', 'daire_id', 'tarih'])
          .ignore();
      }
    }

    const liste = await db('daireler as d')
      .leftJoin('gece_cetelesi as g', function () {
        this.on('g.daire_id', '=', 'd.id')
          .andOn('g.site_id', '=', db.raw('?', [siteId]))
          .andOn('g.tarih', '=', db.raw('?', [tarih]));
      })
      .where({ 'd.site_id': siteId, 'd.aktif': true })
      .orderBy('d.blok')
      .orderBy('d.sira_no')
      .select(
        'd.id as daire_id',
        'd.daire_no',
        'd.blok',
        'd.sira_no',
        db.raw('COALESCE(g.arac_sayisi, 0)::int as arac_sayisi')
      );

    res.json({ tarih, daireler: liste });
  } catch (e) { next(e); }
});

// Bir dairenin gece çetelesi sayısını +1/-1 değiştir (0'ın altına inmez).
// Atomik upsert: satır yoksa oluşturur, varsa GREATEST(0, sayi+delta) yapar.
router.patch('/gece-cetelesi/:daireId', async (req, res, next) => {
  try {
    const daireId = parseInt(req.params.daireId, 10);
    const siteId = req.scopedSiteId;
    const tarih = req.body?.tarih || todayTR();
    const delta = parseInt(req.body?.delta, 10);
    if (delta !== 1 && delta !== -1) {
      return res.status(400).json({ error: 'delta yalnız +1 veya -1 olabilir.' });
    }

    // Daire bu site'e ait ve aktif mi? (cross-site/silinmiş daireye yazma)
    const daire = await db('daireler')
      .where({ id: daireId, site_id: siteId, aktif: true })
      .first();
    if (!daire) return res.status(404).json({ error: 'Daire bulunamadı.' });

    const seedVal = Math.max(0, delta); // yeni satırda 0 + delta
    const result = await db.raw(
      `INSERT INTO gece_cetelesi (site_id, daire_id, tarih, arac_sayisi)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (site_id, daire_id, tarih)
       DO UPDATE SET arac_sayisi = GREATEST(0, gece_cetelesi.arac_sayisi + ?),
                     guncelleme_zamani = now()
       RETURNING arac_sayisi`,
      [siteId, daireId, tarih, seedVal, delta]
    );
    res.json({ daire_id: daireId, arac_sayisi: result.rows[0].arac_sayisi });
  } catch (e) { next(e); }
});

module.exports = { router, IHLAL_MESAJI };
