const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { detectViolations } = require('../utils/violations');
const { todayTR, normalizeMisafirZaman } = require('../utils/timezone');
const { normalizePlaka } = require('../utils/validators');

const router = express.Router();

const IHLAL_MESAJI =
  'Sayın {sahip}, {daire} numaralı dairenize tanımlı birden fazla araç ({plakalar}) site otoparkında tespit edildi. ' +
  'Lütfen en kısa sürede fazla olan aracı/araçları çıkartınız.';

router.post('/analiz-et', authRequired, async (req, res, next) => {
  try {
    const tarih = req.body?.tarih || todayTR();

    const kontroller = await db('gunluk_kontroller')
      .where({ kontrol_tarihi: tarih })
      .whereNotNull('plaka')
      .where('plaka', '!=', '');
    const plakalar = kontroller.map((k) => k.plaka);

    const aktifAraclar = await db('araclar')
      .join('daireler', 'araclar.daire_id', 'daireler.id')
      .where('araclar.aktif', true)
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
      .where('baslangic_tarihi', '<=', referansZaman)
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
          .where({ kontrol_tarihi: tarih, daire_id: i.daire_id })
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
        .where({ kontrol_tarihi: tarih, ihlal_tipi: 'kayitsiz' })
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
          });
        }
      } else if (existingKayitsiz) {
        await trx('ihlaller').where({ id: existingKayitsiz.id }).delete();
      }
    });

    await writeAudit({
      user_id: req.user.id,
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

router.get('/ihlaller', authRequired, async (req, res, next) => {
  try {
    const { baslangic, bitis, daire_id, tipi } = req.query;
    let qb = db('ihlaller')
      .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
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
    const ihlaller = await qb.orderBy('ihlaller.kontrol_tarihi', 'desc');
    res.json({ ihlaller });
  } catch (e) { next(e); }
});

router.get('/ihlaller/ozet', authRequired, async (req, res, next) => {
  try {
    const { baslangic, bitis } = req.query;
    let qb = db('ihlaller')
      .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
      .where('ihlaller.ihlal_tipi', 'coklu_arac')
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

module.exports = { router, IHLAL_MESAJI };
