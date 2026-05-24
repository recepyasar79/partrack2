const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authRequired, requireRole, requireSiteAdmin, requireSuperadmin, resolveScopedSiteId } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');

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
  const { kullanici_adi, sifre } = req.body || {};
  if (!kullanici_adi || !sifre) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunlu.' });
  }
  const user = await db('users').where({ kullanici_adi }).first();
  if (!user || !user.aktif) {
    await constantTimeFail();
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  const ok = await verifyPassword(sifre, user.sifre_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  await db('users').where({ id: user.id }).update({ son_giris: db.fn.now() });
  const token = signToken({
    id: user.id,
    kullanici_adi: user.kullanici_adi,
    rol: user.rol,
    site_id: user.site_id ?? null,
  });
  res.json({
    token,
    kullanici: {
      id: user.id,
      kullanici_adi: user.kullanici_adi,
      rol: user.rol,
      site_id: user.site_id ?? null,
    },
  });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await db('users')
    .where({ id: req.user.id })
    .select('id', 'kullanici_adi', 'rol', 'site_id', 'aktif', 'son_giris')
    .first();
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  res.json({ kullanici: user });
});

router.post('/register', authRequired, requireSiteAdmin, async (req, res) => {
  const { kullanici_adi, sifre, rol } = req.body || {};
  // site_yonetici sadece kendi sitesine ekleyebilir; superadmin için
  // site_id sırasıyla: body.site_id → query ?siteId (interceptor enjekte
  // eder, ACTIVE_SITE_KEY'den) → resolveScopedSiteId helper.
  let site_id;
  if (req.user.rol === 'superadmin') {
    if (req.body?.site_id != null) {
      site_id = parseInt(req.body.site_id, 10);
    } else {
      site_id = resolveScopedSiteId(req);
    }
    if (!site_id) {
      return res.status(400).json({ error: 'Superadmin kullanıcı eklerken site_id zorunlu (body.site_id veya ?siteId).' });
    }
  } else {
    site_id = req.user.site_id;
  }

  if (!kullanici_adi || !sifre || !['site_yonetici', 'guvenlik'].includes(rol)) {
    return res.status(400).json({ error: 'Eksik veya geçersiz alan.' });
  }
  if (sifre.length < 8) {
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  }
  const existing = await db('users').where({ kullanici_adi }).first();
  if (existing) {
    return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
  }
  const sifre_hash = await hashPassword(sifre);
  const [created] = await db('users')
    .insert({ kullanici_adi, sifre_hash, rol, site_id, aktif: true })
    .returning(['id', 'kullanici_adi', 'rol', 'site_id']);
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id ?? req.body?.site_id ?? null,
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
  const target = await db('users').where({ id: kullanici_id }).first();
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  const sifre_hash = await hashPassword(yeni_sifre);
  await db('users').where({ id: kullanici_id }).update({ sifre_hash });
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id ?? req.body?.site_id ?? null,
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
    eylem: 'sifre_degistir',
    tablo_adi: 'users',
    kayit_id: user.id,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

router.get('/kullanicilar', authRequired, requireSiteAdmin, async (_req, res) => {
  const list = await db('users')
    .select('id', 'kullanici_adi', 'rol', 'aktif', 'son_giris', 'olusturma_zamani')
    .orderBy('id');
  res.json({ kullanicilar: list });
});

router.patch('/kullanicilar/:id', authRequired, requireSiteAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Geçersiz id.' });
  const { aktif } = req.body || {};
  if (typeof aktif !== 'boolean') return res.status(400).json({ error: 'aktif alanı zorunlu.' });
  const target = await db('users').where({ id }).first();
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  await db('users').where({ id }).update({ aktif });
  await writeAudit({
    user_id: req.user.id,
    site_id: req.user.site_id ?? req.body?.site_id ?? null,
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
