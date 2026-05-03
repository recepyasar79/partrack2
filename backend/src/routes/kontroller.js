const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { buildUpload } = require('../services/storage');
const { todayTR } = require('../utils/timezone');
const { normalizePlaka } = require('../utils/validators');

const router = express.Router();
const storage = buildUpload();

router.get('/', authRequired, async (req, res) => {
  const tarih = req.query.tarih || todayTR();
  const list = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih })
    .orderBy('yukleme_zamani', 'desc');
  res.json({ tarih, kontroller: list });
});

router.post('/foto-upload', authRequired, (req, res, next) => {
  storage.upload.single('foto')(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Dosya alınamadı.' });

    const plaka = normalizePlaka(req.body.plaka || '');
    let foto_url;
    if (storage.mode === 'r2') {
      foto_url = storage.publicUrl(req.file.key);
    } else {
      foto_url = storage.publicUrl(req.file.filename);
    }

    db('gunluk_kontroller')
      .insert({
        kontrol_tarihi: todayTR(),
        plaka: plaka || '',
        foto_url,
        yukleyen_user_id: req.user?.id || null,
      })
      .returning('*')
      .then(([row]) => res.status(201).json({ kontrol: row }))
      .catch(next);
  });
});

router.patch('/:id/plaka', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const plaka = normalizePlaka(req.body.plaka || '');
  if (!plaka) return res.status(400).json({ error: 'Plaka zorunlu.' });
  const eski = await db('gunluk_kontroller').where({ id }).first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });
  const [updated] = await db('gunluk_kontroller')
    .where({ id })
    .update({ plaka })
    .returning('*');
  await writeAudit({
    user_id: req.user.id,
    eylem: 'plaka_duzelt',
    tablo_adi: 'gunluk_kontroller',
    kayit_id: id,
    eski_deger: { plaka: eski.plaka },
    yeni_deger: { plaka },
    ip_adres: req.ip,
  });
  res.json({ kontrol: updated });
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('gunluk_kontroller').where({ id }).first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });
  await db('gunluk_kontroller').where({ id }).delete();
  await writeAudit({
    user_id: req.user.id,
    eylem: 'sil',
    tablo_adi: 'gunluk_kontroller',
    kayit_id: id,
    eski_deger: eski,
    ip_adres: req.ip,
  });
  res.json({ ok: true });
});

router.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Dosya çok büyük (max 10MB).' });
  }
  if (err && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err) {
    console.error('[kontroller]', err);
    return res.status(500).json({ error: 'Yükleme başarısız.' });
  }
  res.status(404).json({ error: 'Bulunamadı.' });
});

module.exports = router;
