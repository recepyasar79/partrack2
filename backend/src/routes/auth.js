const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authRequired, requireRole, requireSiteAdmin, requireSuperadmin } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { getEffectiveLimits, isLimitReached } = require('../utils/planLimits');
const lockout = require('../utils/loginLockout');
const { invalidate: invalidateUserStatus } = require('../utils/userStatusCache');

const router = express.Router();

const loginLimiter = process.env.NODE_ENV === 'test'
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Çok fazla deneme. Lütfen bir dakika sonra tekrar deneyin.' },
    });

async function constantTimeFail() {
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 40));
}

router.post('/login', loginLimiter, async (req, res) => {
  const { kullanici_adi, sifre, site_slug } = req.body || {};
  if (!kullanici_adi || !sifre) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunlu.' });
  }

  // Brute-force lockout: rate limit'e ek olarak 10 başarısız deneme →
  // 15dk IP kilidi (Faz 7 planı). Test'te kapalı — suite boyunca aynı
  // IP'den biriken bilinçli hatalı denemeler sonraki testleri kilitlemesin.
  const lockoutAktif = process.env.NODE_ENV !== 'test';
  if (lockoutAktif) {
    const lock = lockout.isLocked(req.ip);
    if (lock.locked) {
      res.set('Retry-After', String(lock.retryAfterSec));
      return res.status(429).json({
        error: 'Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.',
      });
    }
  }
  const loginFail = () => { if (lockoutAktif) lockout.recordFail(req.ip); };

  // 3 alanlı login: site_slug varsa o site'nin user'ını ara (site-bağlı
  // kullanıcılar). Yoksa superadmin pool'una bak (site_id IS NULL).
  // Aynı kullanici_adi farklı sitelerde olabilir → composite unique
  // (site_id, kullanici_adi) ile çakışma yok.
  let user;
  if (site_slug) {
    const site = await db('sites')
      .where({ slug: String(site_slug).trim().toLowerCase() })
      .first();
    if (!site || !site.aktif) {
      loginFail();
      await constantTimeFail();
      return res.status(401).json({ error: 'Site adı veya kullanıcı bilgileri hatalı.' });
    }
    user = await db('users')
      .where({ kullanici_adi, site_id: site.id })
      .first();
  } else {
    // site_slug yoksa: yalnız superadmin pool'una bak
    user = await db('users')
      .where({ kullanici_adi, rol: 'superadmin' })
      .whereNull('site_id')
      .first();
  }

  if (!user || !user.aktif) {
    loginFail();
    await constantTimeFail();
    return res.status(401).json({ error: 'Site adı veya kullanıcı bilgileri hatalı.' });
  }
  const ok = await verifyPassword(sifre, user.sifre_hash);
  if (!ok) {
    loginFail();
    return res.status(401).json({ error: 'Site adı veya kullanıcı bilgileri hatalı.' });
  }
  if (lockoutAktif) lockout.clearFails(req.ip);
  await db('users').where({ id: user.id }).update({ son_giris: db.fn.now() });
  const token = signToken({
    id: user.id,
    kullanici_adi: user.kullanici_adi,
    rol: user.rol,
    site_id: user.site_id ?? null,
  });
  // site bilgisini de cevaba ekle — frontend daire formu vs. site.blok_yapisi'na göre
  // dinamik dropdown üretir. Superadmin için site = null.
  let site = null;
  if (user.site_id) {
    site = await db('sites')
      .where({ id: user.site_id })
      .select('id', 'ad', 'slug', 'plan', 'aktif', 'blok_yapisi', 'plan_limits', 'ikinci_arac_kapasitesi')
      .first();
    if (site) site.limits = getEffectiveLimits(site);
  }
  res.json({
    token,
    kullanici: {
      id: user.id,
      kullanici_adi: user.kullanici_adi,
      rol: user.rol,
      site_id: user.site_id ?? null,
      site,
    },
  });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await db('users')
    .where({ id: req.user.id })
    .select('id', 'kullanici_adi', 'rol', 'site_id', 'aktif', 'son_giris')
    .first();
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  let site = null;
  if (user.site_id) {
    site = await db('sites')
      .where({ id: user.site_id })
      .select('id', 'ad', 'slug', 'plan', 'aktif', 'blok_yapisi', 'plan_limits', 'ikinci_arac_kapasitesi')
      .first();
    if (site) site.limits = getEffectiveLimits(site);
  }
  res.json({ kullanici: { ...user, site } });
});

router.post('/register', authRequired, requireSiteAdmin, async (req, res) => {
  const { kullanici_adi, sifre, rol } = req.body || {};
  // requireSiteAdmin sadece site_yonetici'ye izin verir → kendi site'sine
  // kullanıcı ekler. Superadmin için bu endpoint kapalıdır; süper-admin
  // /sites/:id/users üzerinden kullanıcı ekler.
  const site_id = req.user.site_id;

  if (!kullanici_adi || !sifre || !['site_yonetici', 'guvenlik'].includes(rol)) {
    return res.status(400).json({ error: 'Eksik veya geçersiz alan.' });
  }
  if (sifre.length < 8) {
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  }
  // Aynı kullanıcı adı farklı sitelerde olabilir (composite unique
  // (site_id, kullanici_adi)). Yalnız bu site içindeki çakışmaya bak.
  const existing = await db('users').where({ kullanici_adi, site_id }).first();
  if (existing) {
    return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
  }

  // Plan limit kontrolü (Ü2). Aktif kullanıcı sayısı plan'a göre sınırlı.
  const site = await db('sites').where({ id: site_id }).first();
  if (site) {
    const limits = getEffectiveLimits(site);
    const aktifCount = await db('users')
      .where({ site_id, aktif: true })
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
  }
  const sifre_hash = await hashPassword(sifre);
  const [created] = await db('users')
    .insert({ kullanici_adi, sifre_hash, rol, site_id, aktif: true })
    .returning(['id', 'kullanici_adi', 'rol', 'site_id']);
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id,
    eylem: 'kayit',
    tablo_adi: 'users',
    kayit_id: created.id,
    yeni_deger: { kullanici_adi, rol, site_id },
    ip_adres: req.ip,
  });
  res.status(201).json({ kullanici: created });
});

router.post('/sifre-sifirla', authRequired, requireSiteAdmin, async (req, res) => {
  const { kullanici_id, yeni_sifre } = req.body || {};
  if (!kullanici_id || !yeni_sifre || yeni_sifre.length < 8) {
    return res.status(400).json({ error: 'Geçersiz alan veya şifre çok kısa.' });
  }
  // Site yöneticisi sadece kendi sitesindeki kullanıcıların şifresini
  // sıfırlayabilir. Başka site'nin kullanıcısı veya superadmin ID'si
  // gelse bile bulunamadı yanıtı dön.
  const target = await db('users')
    .where({ id: kullanici_id, site_id: req.user.site_id })
    .first();
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  const sifre_hash = await hashPassword(yeni_sifre);
  await db('users').where({ id: kullanici_id }).update({ sifre_hash });
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id,
    eylem: 'sifre_sifirla',
    tablo_adi: 'users',
    kayit_id: kullanici_id,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

router.post('/sifre-degistir', authRequired, async (req, res) => {
  const { eski_sifre, yeni_sifre } = req.body || {};
  if (!eski_sifre || !yeni_sifre || yeni_sifre.length < 8) {
    return res.status(400).json({ error: 'Eksik alan veya yeni şifre çok kısa.' });
  }
  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  const ok = await verifyPassword(eski_sifre, user.sifre_hash);
  if (!ok) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
  const sifre_hash = await hashPassword(yeni_sifre);
  await db('users').where({ id: user.id }).update({ sifre_hash });
  await writeAudit({
    user_id: user.id,
    site_id: user.site_id ?? null,
    eylem: 'sifre_degistir',
    tablo_adi: 'users',
    kayit_id: user.id,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

router.get('/kullanicilar', authRequired, requireSiteAdmin, async (req, res) => {
  // Site yöneticisi yalnız kendi sitesindeki kullanıcıları görür.
  // Superadmin ve diğer sitelerin kullanıcıları listede çıkmaz —
  // tenant izolasyonu (KVKK + müşteri güveni).
  const list = await db('users')
    .where({ site_id: req.user.site_id })
    .select('id', 'kullanici_adi', 'rol', 'aktif', 'son_giris', 'olusturma_zamani')
    .orderBy('id');
  res.json({ kullanicilar: list });
});

router.patch('/kullanicilar/:id', authRequired, requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Geçersiz id.' });
  const { aktif } = req.body || {};
  if (typeof aktif !== 'boolean') return res.status(400).json({ error: 'aktif alanı zorunlu.' });
  // Site yöneticisi yalnız kendi sitesindeki kullanıcıyı aktif/pasif yapabilir.
  const target = await db('users')
    .where({ id, site_id: req.user.site_id })
    .first();
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  await db('users').where({ id }).update({ aktif });
  // Oturum durumu cache'ini düş → deaktivasyon TTL beklemeden anında geçerli
  // (authRequired sonraki istekte 401 döner).
  invalidateUserStatus(id);
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id,
    eylem: aktif ? 'aktif' : 'deaktif',
    tablo_adi: 'users',
    kayit_id: id,
    eski_deger: { aktif: target.aktif },
    yeni_deger: { aktif },
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

module.exports = router;
