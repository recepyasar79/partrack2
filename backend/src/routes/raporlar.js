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
    // Dönem özeti (Bugün / Bu Hafta / Bu Ay) — üst tarih filtresinden
    // bağımsız. Hafta Pazartesi başlar; ay başı ile hafta başının erken
    // olanından itibaren tek sorguda çek, JS'te 3 pencereye ayır.
    const bugun = todayTR();
    const bugunD = dayjs.tz(bugun, TR_TZ);
    const haftaBasi = bugunD.subtract((bugunD.day() + 6) % 7, 'day').format('YYYY-MM-DD');
    const ayBasi = bugunD.startOf('month').format('YYYY-MM-DD');
    const donemBasi = haftaBasi < ayBasi ? haftaBasi : ayBasi;

    const [
      ihlalAgg,
      kontrolGunRow,
      fotoCountRow,
      bildirimAgg,
      gunlukRows,
      aylikRows,
      blokRows,
      topRows,
      donemRows,
    ] = await Promise.all([
      db('ihlaller')
        // Fazla araç sayımı dairenin 2. araç hakkını bilmeli → daireler join.
        // leftJoin: kayıtsız ihlallerinde daire_id NULL, inner join onları yutardı.
        .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
        .where({ 'ihlaller.site_id': siteId })
        .whereBetween('ihlaller.kontrol_tarihi', [baslangic, bitis])
        .select(
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='coklu_arac' THEN 1 ELSE 0 END),0)::int as coklu_arac`),
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='kayitsiz' THEN 1 ELSE 0 END),0)::int as kayitsiz`),
          db.raw(`COUNT(DISTINCT ihlaller.daire_id) FILTER (WHERE ihlaller.daire_id IS NOT NULL)::int as etkilenen_daire`),
          // Araç-adedi metrikleri: ihlal KAYDI sayısı kullanıcıyı yanıltıyordu
          // (4 foto yükleyip "Toplam İhlal 1" görüyordu — 1 kayıtsız kaydında
          // N plaka). Kayıtsız = listedeki plaka adedi.
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='kayitsiz' THEN jsonb_array_length(plaka_listesi) ELSE 0 END),0)::int as kayitsiz_arac`),
          // Misafir araç = çoklu ihlallerdeki misafir plaka adedi (ayrı kutu).
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='coklu_arac' THEN jsonb_array_length(COALESCE(misafir_plaka_listesi,'[]'::jsonb)) ELSE 0 END),0)::int as misafir_arac`),
          // Çoklu (fazla) araç = dairenin KENDI fazla aracı; misafirler düşülür
          // (ayrı kutuda gösterilir). (k_toplam - misafir) - hak; izinli daire
          // 2'ye, normal daire 1'e kadar muaf.
          db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='coklu_arac' THEN GREATEST((jsonb_array_length(plaka_listesi) - jsonb_array_length(COALESCE(misafir_plaka_listesi,'[]'::jsonb))) - (CASE WHEN daireler.ikinci_arac_izinli THEN 2 ELSE 1 END), 0) ELSE 0 END),0)::int as coklu_fazla_arac`)
        )
        .first(),
      db('gunluk_kontroller')
        .join('users', 'gunluk_kontroller.yukleyen_user_id', 'users.id')
        .where('users.site_id', siteId)
        .whereBetween('kontrol_tarihi', [baslangic, bitis])
        .countDistinct({ c: 'kontrol_tarihi' })
        .first(),
      // Yüklenen foto adedi — gunluk_kontroller'in kendi site_id'si var,
      // users join'ine gerek yok.
      db('gunluk_kontroller')
        .where({ site_id: siteId })
        .whereBetween('kontrol_tarihi', [baslangic, bitis])
        .count('* as c')
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
      db('ihlaller')
        .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
        .where({ 'ihlaller.site_id': siteId })
        .where('ihlaller.kontrol_tarihi', '>=', donemBasi)
        .select(
          db.raw(`to_char(ihlaller.kontrol_tarihi, 'YYYY-MM-DD') as tarih`),
          'ihlaller.ihlal_tipi',
          db.raw(`jsonb_array_length(ihlaller.plaka_listesi)::int as arac`),
          db.raw(`jsonb_array_length(COALESCE(ihlaller.misafir_plaka_listesi,'[]'::jsonb))::int as misafir`),
          db.raw(`COALESCE(daireler.ikinci_arac_izinli, false) as ikinci_arac_izinli`)
        ),
    ]);
    const kontrol_yapilan_gun = parseInt(kontrolGunRow?.c || 0, 10);

    // donemRows → Bugün / Bu Hafta / Bu Ay araç sayıları
    const donemOzetBos = () => ({ kayitsiz_arac: 0, coklu_fazla_arac: 0, misafir_arac: 0 });
    const donem_ozet = { bugun: donemOzetBos(), bu_hafta: donemOzetBos(), bu_ay: donemOzetBos() };
    for (const r of donemRows) {
      const hedefler = [];
      if (r.tarih >= ayBasi) hedefler.push(donem_ozet.bu_ay);
      if (r.tarih >= haftaBasi) hedefler.push(donem_ozet.bu_hafta);
      if (r.tarih === bugun) hedefler.push(donem_ozet.bugun);
      for (const h of hedefler) {
        if (r.ihlal_tipi === 'kayitsiz') h.kayitsiz_arac += r.arac;
        // Çoklu: misafirler ayrı kutuya; fazla = (arac - misafir) - hak.
        // İzinli daire 2 araca muaf, normal daire 1'e.
        else if (r.ihlal_tipi === 'coklu_arac') {
          h.misafir_arac += r.misafir;
          h.coklu_fazla_arac += Math.max((r.arac - r.misafir) - (r.ikinci_arac_izinli ? 2 : 1), 0);
        }
      }
    }

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
        // Araç-adedi metrikleri (kart başlıkları bunları gösterir)
        toplam_foto: parseInt(fotoCountRow?.c || 0, 10),
        kayitsiz_arac: ihlalAgg.kayitsiz_arac || 0,
        coklu_fazla_arac: ihlalAgg.coklu_fazla_arac || 0,
        misafir_arac: ihlalAgg.misafir_arac || 0,
      },
      donem_ozet,
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
