const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { detectViolations } = require('../utils/violations');
const { ceteleGunuTR, normalizeMisafirZaman } = require('../utils/timezone');
const { normalizePlaka } = require('../utils/validators');

const router = express.Router();

router.use(authRequired, requireScopedSite);

const IHLAL_MESAJI =
  'Sayın {sahip}, {daire} numaralı dairenize tanımlı birden fazla araç ({plakalar}) site otoparkında tespit edildi. ' +
  'Lütfen en kısa sürede fazla olan aracı/araçları çıkartınız.';

router.post('/analiz-et', async (req, res, next) => {
  try {
    // Operasyon günü (08:00 sınırı): yükleme/liste/çetele ile aynı tarih
    // referansı. Gece kontrolü 00:00'ı geçse de aynı kontrol gününe yazılır
    // — analiz yüklemeleri kaçırmaz ve midnight-spanning tekrar çağrılar
    // aynı kontrol_tarihi'ne idempotent düşer (ihlaller UNIQUE).
    const tarih = req.body?.tarih || ceteleGunuTR();
    const siteId = req.scopedSiteId;

    const kontroller = await db('gunluk_kontroller')
      .where({ kontrol_tarihi: tarih, site_id: siteId })
      .whereNull('cikis_zamani') // yalnız hâlâ içeride olan araçlar (çıkış yapan düşer)
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
        'daireler.bildirim_opt_in',
        'daireler.ikinci_arac_izinli'
      );
    const plakaToDaire = new Map();
    for (const a of aktifAraclar) plakaToDaire.set(normalizePlaka(a.plaka), a);

    // Misafir muafiyeti GÜN bazlıdır: o gün herhangi bir anda aktif olan misafir
    // kaydı dairesine sayılır ve ASLA kayıtsız raporlanmaz. Tek nokta (20:00)
    // referansı, 20:30'da kaydedilen ya da gündüz pencereli misafiri dışarda
    // bırakıp plakayı kayıtsıza düşürüyordu (kontroller GET ile tutarsızdı).
    // Gün başı/sonu sınırlarıyla eşle (kontroller/misafirAraclar GET ile aynı).
    const gunBasi = req.body?.referans_zaman || normalizeMisafirZaman(tarih, false);
    const gunSonu = normalizeMisafirZaman(tarih, true);
    const misafirler = await db('misafir_araclar')
      .join('daireler', 'misafir_araclar.daire_id', 'daireler.id')
      .where('misafir_araclar.site_id', siteId)
      .andWhere('baslangic_tarihi', '<=', gunSonu)
      .andWhere('bitis_tarihi', '>=', gunBasi)
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
        'daireler.bildirim_opt_in',
        'daireler.ikinci_arac_izinli'
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
              .update({
                plaka_listesi: JSON.stringify(i.plakalar),
                misafir_plaka_listesi: JSON.stringify(i.misafir_plakalar || []),
              });
            guncellenenler.push({ ihlal_id: existing.id, daire_no: i.daire_no, plakalar: i.plakalar });
          }
        } else {
          const [created] = await trx('ihlaller')
            .insert({
              kontrol_tarihi: tarih,
              daire_id: i.daire_id,
              daire_no_snapshot: i.daire_no,
              plaka_listesi: JSON.stringify(i.plakalar),
              misafir_plaka_listesi: JSON.stringify(i.misafir_plakalar || []),
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
 * Verilen tarih için her dairenin içeride tespit edilen PLAKALARINI hesapla.
 * Mantık analiz-et ile aynı: bugün görülen farklı plakaları kayıtlı araç ya da
 * o an aktif misafir üzerinden daireye eşler, daire başına grupla. Misafir
 * eşleşmesi kayıtlıya göre önceliklidir (detectViolations ile tutarlı).
 * Kayıtsız plakalar hiçbir daireye sayılmaz. Araç sayısı = plaka adedi.
 * @returns {Promise<Map<number, string[]>>} daire_id → içerideki plakalar
 */
async function dairBasinaPlakalar(siteId, tarih) {
  const kontroller = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih, site_id: siteId })
    .whereNull('cikis_zamani') // yalnız hâlâ içeride
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

  // Misafir muafiyeti gün bazlı: o gün herhangi bir anda aktif misafiri eşle
  // (analiz-et ile tutarlı; tek nokta 20:00 referansı kaldırıldı).
  const gunBasi = normalizeMisafirZaman(tarih, false);
  const gunSonu = normalizeMisafirZaman(tarih, true);
  const misafirler = await db('misafir_araclar')
    .where('site_id', siteId)
    .andWhere('baslangic_tarihi', '<=', gunSonu)
    .andWhere('bitis_tarihi', '>=', gunBasi)
    .select('plaka', 'daire_id');
  const misafirToDaire = new Map();
  for (const m of misafirler) misafirToDaire.set(normalizePlaka(m.plaka), m.daire_id);

  const byDaire = new Map();
  for (const p of gorulen) {
    const daireId = misafirToDaire.has(p) ? misafirToDaire.get(p) : plakaToDaire.get(p);
    if (daireId == null) continue; // kayıtsız → sayılmaz
    if (!byDaire.has(daireId)) byDaire.set(daireId, []);
    byDaire.get(daireId).push(p);
  }
  return byDaire;
}

/**
 * Header kutucuğu için hafif özet: o gün içeride tespit edilen toplam araç
 * sayısı ve bunların kaçının misafir olduğu. Çeteleyle aynı eşleştirme mantığı
 * (kayıtlı + gün-bazlı misafir; kayıtsız sayılmaz). Misafir, kayıtlıya göre
 * önceliklidir — dairBasinaPlakalar ile tutarlı.
 * @returns {Promise<{ icerideki_arac: number, misafir_arac: number }>}
 */
async function iceriOzet(siteId, tarih) {
  const kontroller = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih, site_id: siteId })
    .whereNull('cikis_zamani') // yalnız hâlâ içeride
    .whereNotNull('plaka')
    .where('plaka', '!=', '');
  const gorulen = new Set();
  for (const k of kontroller) {
    const p = normalizePlaka(k.plaka);
    if (p) gorulen.add(p);
  }
  if (!gorulen.size) return { icerideki_arac: 0, misafir_arac: 0 };

  const aktifAraclar = await db('araclar')
    .where({ site_id: siteId, aktif: true })
    .select('plaka', 'daire_id');
  const plakaToDaire = new Map();
  for (const a of aktifAraclar) plakaToDaire.set(normalizePlaka(a.plaka), a.daire_id);

  const gunBasi = normalizeMisafirZaman(tarih, false);
  const gunSonu = normalizeMisafirZaman(tarih, true);
  const misafirler = await db('misafir_araclar')
    .where('site_id', siteId)
    .andWhere('baslangic_tarihi', '<=', gunSonu)
    .andWhere('bitis_tarihi', '>=', gunBasi)
    .select('plaka', 'daire_id');
  const misafirToDaire = new Map();
  for (const m of misafirler) misafirToDaire.set(normalizePlaka(m.plaka), m.daire_id);

  let icerideki = 0;
  let misafir = 0;
  for (const p of gorulen) {
    if (misafirToDaire.has(p)) {
      icerideki += 1;
      misafir += 1;
    } else if (plakaToDaire.has(p)) {
      icerideki += 1;
    }
    // kayıtsız → sayılmaz
  }
  return { icerideki_arac: icerideki, misafir_arac: misafir };
}

// Header kutucuğu özeti: park kapasitesi (site'den) + içerideki araç + misafir.
router.get('/gece-cetelesi/ozet', async (req, res, next) => {
  try {
    const tarih = req.query.tarih || ceteleGunuTR();
    const siteId = req.scopedSiteId;
    const site = await db('sites').where({ id: siteId }).select('park_kapasitesi').first();
    const { icerideki_arac, misafir_arac } = await iceriOzet(siteId, tarih);
    res.json({
      tarih,
      park_kapasitesi: site?.park_kapasitesi ?? 0,
      icerideki_arac,
      misafir_arac,
    });
  } catch (e) { next(e); }
});

// Tüm aktif daireleri + o gün içeride tespit edilen araç sayısı ve plakalarını
// döner. Çetele artık tamamen TÜREVDIR (gunluk_kontroller'den canlı hesaplanır):
// araç girişi elle plaka ekleme (POST /manuel) ile, çıkış "bugün yüklenenler"
// gridinden silme (DELETE /:id) ile yapılır; her ikisi de gunluk_kontroller'i
// değiştirdiğinden çetele otomatik güncellenir. Elle +/- sayım ve gece_cetelesi
// tablosu kaldırıldı.
router.get('/gece-cetelesi', async (req, res, next) => {
  try {
    // Çetele günü sabah 08:00'de döner (gece yarısında değil) → gece 00:00-08:00
    // arası akşam kontrolü çetelesi korunur.
    const tarih = req.query.tarih || ceteleGunuTR();
    const siteId = req.scopedSiteId;

    const daireler = await db('daireler')
      .where({ site_id: siteId, aktif: true })
      .orderBy('blok')
      .orderBy('sira_no')
      .select('id as daire_id', 'daire_no', 'blok', 'sira_no', 'ikinci_arac_izinli');

    const byDaire = await dairBasinaPlakalar(siteId, tarih);
    const liste = daireler.map((d) => {
      const plakalar = byDaire.get(d.daire_id) || [];
      return { ...d, plakalar, arac_sayisi: plakalar.length };
    });

    res.json({ tarih, daireler: liste });
  } catch (e) { next(e); }
});

module.exports = { router, IHLAL_MESAJI };
