/**
 * Faz Ü5 — Raporlama/Dashboard.
 *
 * GET /api/raporlar/dashboard?baslangic=YYYY-MM-DD&bitis=YYYY-MM-DD
 *
 * Site bazlı toplu özet — özet sayaçlar, günlük trend, aylık trend (son 12 ay,
 * dönemden bağımsız), blok dağılımı, en çok ihlal yapan ilk 10 daire ve
 * bildirim başarı oranı tek call'da döner. Site yöneticisi + güvenlik erişir.
 */
const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite, requireSiteAdmin } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { todayTR, dayjs, TR_TZ } = require('../utils/timezone');

const router = express.Router();
router.use(authRequired, requireScopedSite);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_FREQ = new Set(['daily', 'weekly', 'monthly']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeRange(q) {
  const bitis = DATE_RE.test(q.bitis || '') ? q.bitis : todayTR();
  const baslangic = DATE_RE.test(q.baslangic || '')
    ? q.baslangic
    : dayjs.tz(bitis, TR_TZ).subtract(29, 'day').format('YYYY-MM-DD');
  return { baslangic, bitis };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const siteId = req.scopedSiteId;
    const { baslangic, bitis } = normalizeRange(req.query);
    const aylik_bitis = dayjs.tz(bitis, TR_TZ).endOf('month').format('YYYY-MM-DD');
    const aylik_baslangic = dayjs
      .tz(aylik_bitis, TR_TZ)
      .subtract(11, 'month')
      .startOf('month')
      .format('YYYY-MM-DD');

    // 7 sorgu birbirinden bağımsız — seri await yerine tek dalgada çalıştır.
    // Neon'a RTT başına ~20-40ms; seri haliyle dashboard 150-250ms ekstra
    // bekliyordu. Knex query builder'ları thenable — Promise.all direkt alır.
    const [
      ihlalAgg,
      kontrolGunRow,
      bildirimAgg,
      gunlukRows,
      aylikRows,
      blokRows,
      topRows,
    ] = await Promise.all([
      db('ihlaller')
        .where({ site_id: siteId })
        .whereBetween('kontrol_tarihi', [baslangic, bitis])
        .select(
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='coklu_arac' THEN 1 ELSE 0 END),0)::int as coklu_arac`),
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='kayitsiz' THEN 1 ELSE 0 END),0)::int as kayitsiz`),
          db.raw(`COUNT(DISTINCT daire_id) FILTER (WHERE daire_id IS NOT NULL)::int as etkilenen_daire`)
        )
        .first(),
      db('gunluk_kontroller')
        .join('users', 'gunluk_kontroller.yukleyen_user_id', 'users.id')
        .where('users.site_id', siteId)
        .whereBetween('kontrol_tarihi', [baslangic, bitis])
        .countDistinct({ c: 'kontrol_tarihi' })
        .first(),
      db('bildirimler')
        .where({ site_id: siteId })
        .whereBetween('olusturma_zamani', [baslangic, dayjs.tz(bitis, TR_TZ).endOf('day').toISOString()])
        .select(
          db.raw(`COUNT(*)::int as toplam`),
          db.raw(`COALESCE(SUM(CASE WHEN gonderim_durumu='gonderildi' THEN 1 ELSE 0 END),0)::int as gonderildi`),
          db.raw(`COALESCE(SUM(CASE WHEN gonderim_durumu='basarisiz' THEN 1 ELSE 0 END),0)::int as basarisiz`),
          db.raw(`COALESCE(SUM(CASE WHEN gonderim_durumu='beklemede' THEN 1 ELSE 0 END),0)::int as beklemede`)
        )
        .first(),
      db('ihlaller')
        .where({ site_id: siteId })
        .whereBetween('kontrol_tarihi', [baslangic, bitis])
        .groupBy('kontrol_tarihi', 'ihlal_tipi')
        .select(
          db.raw(`to_char(kontrol_tarihi, 'YYYY-MM-DD') as tarih`),
          'ihlal_tipi',
          db.raw(`COUNT(*)::int as adet`)
        ),
      db('ihlaller')
        .where({ site_id: siteId })
        .whereBetween('kontrol_tarihi', [aylik_baslangic, aylik_bitis])
        .groupByRaw(`to_char(kontrol_tarihi, 'YYYY-MM'), ihlal_tipi`)
        .select(
          db.raw(`to_char(kontrol_tarihi, 'YYYY-MM') as ay`),
          'ihlal_tipi',
          db.raw(`COUNT(*)::int as adet`)
        ),
      db('ihlaller')
        .join('daireler', 'ihlaller.daire_id', 'daireler.id')
        .where('ihlaller.site_id', siteId)
        .whereBetween('ihlaller.kontrol_tarihi', [baslangic, bitis])
        .andWhere('ihlaller.ihlal_tipi', 'coklu_arac')
        .groupBy('daireler.blok')
        .select('daireler.blok', db.raw(`COUNT(*)::int as ihlal`))
        .orderBy('daireler.blok', 'asc'),
      db('ihlaller')
        .join('daireler', 'ihlaller.daire_id', 'daireler.id')
        .where('ihlaller.site_id', siteId)
        .whereBetween('ihlaller.kontrol_tarihi', [baslangic, bitis])
        .andWhere('ihlaller.ihlal_tipi', 'coklu_arac')
        .groupBy('daireler.id', 'daireler.daire_no', 'daireler.sahip_ad')
        .select(
          'daireler.daire_no',
          'daireler.sahip_ad',
          db.raw(`COUNT(*)::int as ihlal_sayisi`),
          db.raw(`MAX(ihlaller.kontrol_tarihi) as son_ihlal`)
        )
        .orderBy('ihlal_sayisi', 'desc')
        .limit(10),
    ]);
    const kontrol_yapilan_gun = parseInt(kontrolGunRow?.c || 0, 10);

    const gunlukMap = new Map();
    for (const r of gunlukRows) {
      if (!gunlukMap.has(r.tarih)) gunlukMap.set(r.tarih, { tarih: r.tarih, coklu_arac: 0, kayitsiz: 0 });
      gunlukMap.get(r.tarih)[r.ihlal_tipi] = r.adet;
    }
    const gunluk_trend = Array.from(gunlukMap.values()).sort((a, b) => a.tarih.localeCompare(b.tarih));

    const aylikMap = new Map();
    for (const r of aylikRows) {
      if (!aylikMap.has(r.ay)) aylikMap.set(r.ay, { ay: r.ay, coklu_arac: 0, kayitsiz: 0 });
      aylikMap.get(r.ay)[r.ihlal_tipi] = r.adet;
    }
    const aylik_trend = Array.from(aylikMap.values()).sort((a, b) => a.ay.localeCompare(b.ay));

    const blok_dagilim = blokRows.map((r) => ({ blok: r.blok, ihlal: r.ihlal }));

    const top_daireler = topRows.map((r) => ({
      daire_no: r.daire_no,
      sahip_ad: r.sahip_ad,
      ihlal_sayisi: r.ihlal_sayisi,
      son_ihlal: r.son_ihlal,
    }));

    const toplam = (ihlalAgg.coklu_arac || 0) + (ihlalAgg.kayitsiz || 0);
    const bildirim_toplam = bildirimAgg.toplam || 0;
    const basari_orani = bildirim_toplam > 0
      ? Math.round((bildirimAgg.gonderildi / bildirim_toplam) * 1000) / 10
      : 0;

    res.json({
      donem: { baslangic, bitis },
      ozet: {
        toplam_ihlal: toplam,
        coklu_arac: ihlalAgg.coklu_arac || 0,
        kayitsiz: ihlalAgg.kayitsiz || 0,
        etkilenen_daire: ihlalAgg.etkilenen_daire || 0,
        kontrol_yapilan_gun,
      },
      bildirim: {
        toplam: bildirim_toplam,
        gonderildi: bildirimAgg.gonderildi || 0,
        basarisiz: bildirimAgg.basarisiz || 0,
        beklemede: bildirimAgg.beklemede || 0,
        basari_orani,
      },
      gunluk_trend,
      aylik_trend,
      blok_dagilim,
      top_daireler,
    });
  } catch (e) { next(e); }
});

/**
 * Faz Ü7.2 — Email rapor aboneliği CRUD.
 * Site yöneticisi kendi site'sinin schedules'ını yönetir.
 */
router.get('/schedules', async (req, res, next) => {
  try {
    const list = await db('report_schedules')
      .where({ site_id: req.scopedSiteId })
      .orderBy('created_at', 'desc');
    res.json({ schedules: list });
  } catch (e) { next(e); }
});

router.post('/schedules', requireSiteAdmin, async (req, res, next) => {
  try {
    const { email, frequency, enabled } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz.' });
    }
    if (!VALID_FREQ.has(frequency)) {
      return res.status(400).json({ error: 'frequency daily/weekly/monthly olmalı.' });
    }
    try {
      const [row] = await db('report_schedules').insert({
        site_id: req.scopedSiteId,
        email: email.toLowerCase().trim(),
        frequency,
        enabled: enabled !== false,
        created_by_user_id: req.user.id,
      }).returning('*');
      await writeAudit({
        user_id: req.user.id, site_id: req.scopedSiteId,
        eylem: 'ekle', tablo_adi: 'report_schedules', kayit_id: row.id,
        yeni_deger: { email: row.email, frequency: row.frequency, enabled: row.enabled },
        ip_adres: req.ip,
      });
      res.status(201).json({ schedule: row });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bu e-posta + sıklık kombinasyonu zaten kayıtlı.' });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

router.put('/schedules/:id', requireSiteAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('report_schedules')
      .where({ id, site_id: req.scopedSiteId }).first();
    if (!existing) return res.status(404).json({ error: 'Schedule bulunamadı.' });

    const patch = {};
    if (req.body?.email !== undefined) {
      if (!EMAIL_RE.test(req.body.email)) {
        return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz.' });
      }
      patch.email = req.body.email.toLowerCase().trim();
    }
    if (req.body?.frequency !== undefined) {
      if (!VALID_FREQ.has(req.body.frequency)) {
        return res.status(400).json({ error: 'frequency daily/weekly/monthly olmalı.' });
      }
      patch.frequency = req.body.frequency;
    }
    if (req.body?.enabled !== undefined) patch.enabled = !!req.body.enabled;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan yok.' });
    }
    patch.updated_at = db.fn.now();

    try {
      const [row] = await db('report_schedules')
        .where({ id }).update(patch).returning('*');
      await writeAudit({
        user_id: req.user.id, site_id: req.scopedSiteId,
        eylem: 'guncelle', tablo_adi: 'report_schedules', kayit_id: id,
        eski_deger: existing, yeni_deger: row, ip_adres: req.ip,
      });
      res.json({ schedule: row });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bu e-posta + sıklık kombinasyonu zaten kayıtlı.' });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

router.delete('/schedules/:id', requireSiteAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('report_schedules')
      .where({ id, site_id: req.scopedSiteId }).first();
    if (!existing) return res.status(404).json({ error: 'Schedule bulunamadı.' });
    await db('report_schedules').where({ id }).delete();
    await writeAudit({
      user_id: req.user.id, site_id: req.scopedSiteId,
      eylem: 'sil', tablo_adi: 'report_schedules', kayit_id: id,
      eski_deger: existing, ip_adres: req.ip,
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
