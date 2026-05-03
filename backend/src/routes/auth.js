const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authRequired, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

const loginLimiter = rateLimit({
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
  const token = signToken({ id: user.id, kullanici_adi: user.kullanici_adi, rol: user.rol });
  res.json({
    token,
    kullanici: { id: user.id, kullanici_adi: user.kullanici_adi, rol: user.rol },
  });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await db('users')
    .where({ id: req.user.id })
    .select('id', 'kullanici_adi', 'rol', 'aktif', 'son_giris')
    .first();
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  res.json({ kullanici: user });
});

router.post('/register', authRequired, requireRole('yonetici'), async (req, res) => {
  const { kullanici_adi, sifre, rol } = req.body || {};
  if (!kullanici_adi || !sifre || !['yonetici', 'guvenlik'].includes(rol)) {
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
    .insert({ kullanici_adi, sifre_hash, rol, aktif: true })
    .returning(['id', 'kullanici_adi', 'rol']);
  await writeAudit({
    user_id: req.user.id,
    eylem: 'kayit',
    tablo_adi: 'users',
    kayit_id: created.id,
    yeni_deger: { kullanici_adi, rol },
    ip_adres: req.ip,
  });
  res.status(201).json({ kullanici: created });
});

router.post('/sifre-sifirla', authRequired, requireRole('yonetici'), async (req, res) => {
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

router.get('/kullanicilar', authRequired, requireRole('yonetici'), async (_req, res) => {
  const list = await db('users')
    .select('id', 'kullanici_adi', 'rol', 'aktif', 'son_giris', 'olusturma_zamani')
    .orderBy('id');
  res.json({ kullanicilar: list });
});

router.patch('/kullanicilar/:id', authRequired, requireRole('yonetici'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Geçersiz id.' });
  const { aktif } = req.body || {};
  if (typeof aktif !== 'boolean') return res.status(400).json({ error: 'aktif alanı zorunlu.' });
  const target = await db('users').where({ id }).first();
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  await db('users').where({ id }).update({ aktif });
  await writeAudit({
    user_id: req.user.id,
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
