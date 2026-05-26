/**
 * Süper-admin Site Yönetimi API'si.
 *
 * Platform sahibi (rol=superadmin) için CRUD + kullanım metrikleri.
 * Site-bağlı user'lar (site_yonetici, guvenlik) bu endpoint'lerin hiçbirine
 * erişemez — `requireSuperadmin` katı kontrolü uyguluyor.
 *
 * Endpoint'ler:
 *   GET    /api/sites               — tüm siteler (özet sayılarla)
 *   POST   /api/sites               — yeni site oluştur
 *   GET    /api/sites/:id           — site detay + kullanım metrikleri
 *   PATCH  /api/sites/:id           — site bilgilerini güncelle
 *   POST   /api/sites/:id/users     — siteye yönetici/guvenlik ata
 *   GET    /api/sites/:id/users     — sitenin kullanıcı listesi
 *   DELETE /api/sites/:id           — soft delete (aktif=false)
 */
const express = require('express');
const db = require('../db');
const { authRequired, requireSuperadmin } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { hashPassword } = require('../utils/auth');
const { generateSiteSlug } = require('../utils/slug');
const { validateBlokYapisi, buildUniformBlokYapisi } = require('../utils/siteYapisi');
const { getEffectiveLimits, isLimitReached, validatePlanLimitsOverride } = require('../utils/planLimits');

const router = express.Router();

router.use(authRequired, requireSuperadmin);

// Slug formatı: 10 karakter güvenli alfabe — tahmin edilemez.
// Sahip değiştirme PATCH ile de slug'ı manuel set edemez (güvenlik için).
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

router.get('/', async (_req, res, next) => {
  try {
    // Her site için temel kullanım sayısını join'siz subquery ile dön
    const sites = await db('sites').orderBy('id').select('*');
    const counts = await db('daireler')
      .where('aktif', true)
      .groupBy('site_id')
      .select('site_id', db.raw('count(*)::int as daire_sayisi'));
    const countMap = new Map(counts.map((c) => [c.site_id, c.daire_sayisi]));

    const userCounts = await db('users')
      .where('aktif', true)
      .whereNotNull('site_id')
      .groupBy('site_id')
      .select('site_id', db.raw('count(*)::int as user_sayisi'));
    const userMap = new Map(userCounts.map((u) => [u.site_id, u.user_sayisi]));

    res.json({
      siteler: sites.map((s) => ({
        ...s,
        daire_sayisi: countMap.get(s.id) || 0,
        user_sayisi: userMap.get(s.id) || 0,
      })),
    });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { ad, plan = 'baslangic' } = req.body || {};
    if (!ad || ad.length < 2) {
      return res.status(400).json({ error: 'Site adı zorunlu.' });
    }
    if (!['baslangic', 'standart', 'pro', 'kurumsal'].includes(plan)) {
      return res.status(400).json({ error: 'Geçersiz plan.' });
    }

    // Blok yapısı: ya tam yapı (blok_yapisi array) ya da hızlı form
    // (blok_sayisi + daire_per_blok). Her ikisi de yoksa boş başlat
    // (sahip sonra PATCH ile ekleyebilir).
    let blokYapisi = [];
    if (Array.isArray(req.body?.blok_yapisi)) {
      const v = validateBlokYapisi(req.body.blok_yapisi);
      if (!v.ok) return res.status(400).json({ error: v.error });
      blokYapisi = v.normalized;
    } else if (req.body?.blok_sayisi != null && req.body?.daire_per_blok != null) {
      const blokSayisi = parseInt(req.body.blok_sayisi, 10);
      const dairePerBlok = parseInt(req.body.daire_per_blok, 10);
      if (!Number.isInteger(blokSayisi) || blokSayisi < 1 || blokSayisi > 26) {
        return res.status(400).json({ error: 'blok_sayisi 1-26 arası olmalı.' });
      }
      if (!Number.isInteger(dairePerBlok) || dairePerBlok < 1 || dairePerBlok > 200) {
        return res.status(400).json({ error: 'daire_per_blok 1-200 arası olmalı.' });
      }
      blokYapisi = buildUniformBlokYapisi(blokSayisi, dairePerBlok);
    }

    // Slug otomatik üretilir — tahmin edilemez (10 karakter). Body'de
    // slug verilse bile YOK SAYILIR (güvenlik: sahip tahmin edilebilir
    // bir slug yazamasın). Çakışma çok düşük ihtimal, retry ile çöz.
    let slug = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateSiteSlug();
      const conflict = await db('sites').where({ slug: candidate }).first();
      if (!conflict) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      return res.status(500).json({ error: 'Slug üretimi başarısız (5 deneme).' });
    }

    const [created] = await db('sites')
      .insert({
        ad,
        slug,
        plan,
        aktif: true,
        blok_yapisi: JSON.stringify(blokYapisi),
      })
      .returning('*');
    await writeAudit({
      user_id: req.user.id,
      site_id: created.id,
      eylem: 'olustur',
      tablo_adi: 'sites',
      kayit_id: created.id,
      yeni_deger: created,
      ip_adres: req.ip,
    });
    res.status(201).json({ site: created });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const site = await db('sites').where({ id }).first();
    if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });

    // Kullanım metrikleri — son 30 gün
    const sinceIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const [
      daireCount,
      aracCount,
      userCount,
      fotoCount,
      ocrCount,
      plateRecognizerCount,
    ] = await Promise.all([
      db('daireler').where({ site_id: id, aktif: true }).count('* as c').first(),
      db('araclar').where({ site_id: id, aktif: true }).count('* as c').first(),
      db('users').where({ site_id: id, aktif: true }).count('* as c').first(),
      db('gunluk_kontroller')
        .where('site_id', id)
        .andWhere('yukleme_zamani', '>=', sinceIso)
        .count('* as c')
        .first(),
      db('ocr_metrics')
        .where('site_id', id)
        .andWhere('created_at', '>=', sinceIso)
        .count('* as c')
        .first(),
      db('ocr_metrics')
        .where('site_id', id)
        .andWhere('ocr_engine', 'plate_recognizer')
        .andWhere('created_at', '>=', sinceIso)
        .count('* as c')
        .first(),
    ]);

    res.json({
      site,
      limits: getEffectiveLimits(site),
      metrikler: {
        daire_sayisi: parseInt(daireCount.c, 10) || 0,
        arac_sayisi: parseInt(aracCount.c, 10) || 0,
        user_sayisi: parseInt(userCount.c, 10) || 0,
        son_30_gun: {
          foto_upload: parseInt(fotoCount.c, 10) || 0,
          ocr_cagrisi: parseInt(ocrCount.c, 10) || 0,
          plate_recognizer_cagrisi: parseInt(plateRecognizerCount.c, 10) || 0,
        },
      },
    });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const eski = await db('sites').where({ id }).first();
    if (!eski) return res.status(404).json({ error: 'Site bulunamadı.' });

    const { ad, plan, aktif, blok_yapisi, slug, plan_limits } = req.body || {};
    const update = {};
    if (ad !== undefined) {
      if (!ad || ad.length < 2) return res.status(400).json({ error: 'Site adı geçersiz.' });
      update.ad = ad;
    }
    // Slug superadmin tarafından manuel set edilebilir. Format: 3-30 karakter,
    // küçük harf + rakam + tire (kenarlarda/ardışık tire yok). Tekillik DB'de
    // UNIQUE; çakışma varsa 409 dön ve update'i hiç başlatma.
    if (slug !== undefined) {
      const yeniSlug = String(slug).trim().toLowerCase();
      if (yeniSlug.length < 3 || yeniSlug.length > 30) {
        return res.status(400).json({ error: 'Site kodu 3-30 karakter olmalı.' });
      }
      if (!SLUG_REGEX.test(yeniSlug)) {
        return res.status(400).json({
          error: 'Site kodu yalnız küçük harf, rakam ve tire içerebilir (kenarlarda tire olamaz).',
        });
      }
      const conflict = await db('sites').where({ slug: yeniSlug }).whereNot({ id }).first();
      if (conflict) {
        return res.status(409).json({ error: 'Bu site kodu başka bir sitede kullanılıyor.' });
      }
      update.slug = yeniSlug;
    }
    if (plan !== undefined) {
      if (!['baslangic', 'standart', 'pro', 'kurumsal'].includes(plan)) {
        return res.status(400).json({ error: 'Geçersiz plan.' });
      }
      update.plan = plan;
    }
    if (aktif !== undefined) update.aktif = !!aktif;
    if (blok_yapisi !== undefined) {
      const v = validateBlokYapisi(blok_yapisi);
      if (!v.ok) return res.status(400).json({ error: v.error });
      update.blok_yapisi = JSON.stringify(v.normalized);
    }
    // plan_limits override (Ü2). null/{} ile reset edilir, plan defaults
    // kullanılır. Sadece daire_max + user_max kabul edilir.
    if (plan_limits !== undefined) {
      const v = validatePlanLimitsOverride(plan_limits);
      if (!v.ok) return res.status(400).json({ error: v.error });
      update.plan_limits = v.normalized == null ? null : JSON.stringify(v.normalized);
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'Güncellenecek alan yok.' });
    }
    const [updated] = await db('sites').where({ id }).update(update).returning('*');
    await writeAudit({
      user_id: req.user.id,
      site_id: id,
      eylem: 'guncelle',
      tablo_adi: 'sites',
      kayit_id: id,
      eski_deger: eski,
      yeni_deger: updated,
      ip_adres: req.ip,
    });
    res.json({ site: updated });
  } catch (e) { next(e); }
});

router.get('/:id/users', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const site = await db('sites').where({ id }).first();
    if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });
    const users = await db('users')
      .where({ site_id: id })
      .select('id', 'kullanici_adi', 'rol', 'aktif', 'son_giris', 'olusturma_zamani')
      .orderBy('id');
    res.json({ users });
  } catch (e) { next(e); }
});

router.post('/:id/users', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const site = await db('sites').where({ id }).first();
    if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });

    const { kullanici_adi, sifre, rol } = req.body || {};
    if (!kullanici_adi || !sifre || !['site_yonetici', 'guvenlik'].includes(rol)) {
      return res.status(400).json({ error: 'kullanici_adi, sifre ve rol (site_yonetici/guvenlik) zorunlu.' });
    }
    if (sifre.length < 8) {
      return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
    }
    // Aynı kullanıcı adı farklı sitelerde olabilir — composite unique
    // (site_id, kullanici_adi). Yalnız bu site içindeki çakışmaya bak.
    const existing = await db('users')
      .where({ kullanici_adi, site_id: id })
      .first();
    if (existing) {
      return res.status(409).json({ error: 'Bu sitede aynı kullanıcı adı zaten var.' });
    }

    // Plan limit kontrolü (Ü2). Aktif kullanıcı (site_yonetici + guvenlik) sayısı.
    const limits = getEffectiveLimits(site);
    const aktifCount = await db('users')
      .where({ site_id: id, aktif: true })
      .count('* as c')
      .first();
    const current = parseInt(aktifCount.c, 10) || 0;
    if (isLimitReached(limits.user_max, current)) {
      return res.status(402).json({
        error: `Plan limiti doldu (${current}/${limits.user_max} kullanıcı). Plan yükseltmek için iletişime geçin.`,
        limit: 'user_max',
        current,
        max: limits.user_max,
      });
    }
    const sifre_hash = await hashPassword(sifre);
    const [created] = await db('users')
      .insert({ kullanici_adi, sifre_hash, rol, site_id: id, aktif: true })
      .returning(['id', 'kullanici_adi', 'rol', 'site_id', 'aktif']);
    await writeAudit({
      user_id: req.user.id,
      site_id: id,
      eylem: 'kayit',
      tablo_adi: 'users',
      kayit_id: created.id,
      yeni_deger: { kullanici_adi, rol, site_id: id },
      ip_adres: req.ip,
    });
    res.status(201).json({ kullanici: created });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === 1) {
      return res.status(400).json({ error: 'Varsayılan site silinemez.' });
    }
    const eski = await db('sites').where({ id }).first();
    if (!eski) return res.status(404).json({ error: 'Site bulunamadı.' });

    // Kalıcı silme — site_id taşıyan tüm tabloları FK bağımlılık sırasına göre
    // temizle. Tek transaction içinde; herhangi bir adım fail olursa hiçbir
    // şey silinmez. Soft delete yerine bilinçli olarak kalıcı silme;
    // superadmin modalda onayladı.
    //
    // Sıra: önce başka tablolara referans veren child'lar, sonra parent'lar,
    // en son sites. araclar/misafir_araclar/daire_sahip_tarihce daireler'e
    // CASCADE bağlı zaten ama explicit silme idempotent ve okunaklı.
    await db.transaction(async (trx) => {
      await trx('bildirimler').where({ site_id: id }).del();
      await trx('ihlaller').where({ site_id: id }).del();
      await trx('gunluk_kontroller').where({ site_id: id }).del();
      await trx('daire_sahip_tarihce').where({ site_id: id }).del();
      await trx('misafir_araclar').where({ site_id: id }).del();
      await trx('araclar').where({ site_id: id }).del();
      await trx('daireler').where({ site_id: id }).del();
      await trx('ocr_metrics').where({ site_id: id }).del();
      await trx('plate_learnings').where({ site_id: id }).del();
      await trx('plate_char_substitutions').where({ site_id: id }).del();
      // audit_log son kalır: site-spesifik log'lar dahil tüm tarih silinir.
      // user_id FK SET NULL olduğu için diğer site'lerin log'ları kırılmaz.
      await trx('audit_log').where({ site_id: id }).del();
      await trx('users').where({ site_id: id }).del();
      await trx('sites').where({ id }).del();
    });

    // audit_log'da site_id NOT NULL — silme olayı için DB'ye yazamayız.
    // Sunucu log'una düş; Fly.io logs'ta görülür, platform sahibi için
    // kalıcı bir iz kalır.
    console.warn('[sites.delete] site kalıcı silindi:', {
      site_id: id,
      site_ad: eski.ad,
      site_slug: eski.slug,
      silen_user_id: req.user.id,
      silen_kullanici_adi: req.user.kullanici_adi,
      ip: req.ip,
      zaman: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
