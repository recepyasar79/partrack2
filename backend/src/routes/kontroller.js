const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { buildUpload, isR2Configured } = require('../services/storage');
const { todayTR } = require('../utils/timezone');
const { normalizePlaka } = require('../utils/validators');
const { correctOCRGuess, recordLearning } = require('../services/plateMatcher');
const { recognizePlate } = require('../services/pythonOcr');

const router = express.Router();
const storage = buildUpload();

let s3ClientPromise = null;
async function getS3() {
  if (!s3ClientPromise) {
    s3ClientPromise = (async () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
    })();
  }
  return s3ClientPromise;
}

function extractR2Key(fotoUrl) {
  try {
    const u = new URL(fotoUrl);
    return u.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

router.get('/', authRequired, async (req, res) => {
  const tarih = req.query.tarih || todayTR();
  const list = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih })
    .orderBy('yukleme_zamani', 'desc');
  const kontroller = list.map((k) => ({
    ...k,
    foto_url_orig: k.foto_url,
    foto_url: k.foto_url ? `/kontroller/${k.id}/foto` : null,
  }));
  res.json({ tarih, kontroller });
});

router.get('/:id/foto', authRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const k = await db('gunluk_kontroller').where({ id }).first();
    if (!k || !k.foto_url) return res.status(404).json({ error: 'Foto bulunamadı.' });

    if (k.foto_url.startsWith('/uploads/') || !isR2Configured()) {
      const filename = k.foto_url.split('/').pop();
      const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
      const filepath = path.join(uploadDir, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Dosya yok.' });
      return res.sendFile(filepath);
    }

    const key = extractR2Key(k.foto_url);
    if (!key) return res.status(500).json({ error: 'Foto URL ayrıştırılamadı.' });

    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = await getS3();
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));

    res.setHeader('Content-Type', obj.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (obj.ContentLength) res.setHeader('Content-Length', String(obj.ContentLength));
    obj.Body.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/foto-upload', authRequired, (req, res, next) => {
  storage.upload.single('foto')(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Dosya alınamadı.' });

    const buffer = req.file.buffer;
    const originalName = req.file.originalname || 'plate.jpg';
    const mimeType = req.file.mimetype || 'image/jpeg';

    // Run OCR and storage upload in parallel — they don't depend on each other
    // and combined network time is dominated by the slower of the two.
    const [ocrResult, savedFile] = await Promise.allSettled([
      recognizePlate(buffer, { filename: originalName, mimeType }),
      storage.save(buffer, originalName, mimeType),
    ]);

    if (savedFile.status !== 'fulfilled') {
      console.error('[kontroller] storage save failed:', savedFile.reason);
      return res.status(500).json({ error: 'Dosya kaydedilemedi.' });
    }

    let plaka = '';
    let ocrInfo = { ok: false, error: 'OCR not run' };

    if (ocrResult.status === 'fulfilled') {
      ocrInfo = ocrResult.value;
      if (ocrInfo.ok && ocrInfo.plate) {
        plaka = normalizePlaka(ocrInfo.plate);
      } else if (!ocrInfo.ok) {
        console.warn('[kontroller] OCR failed:', ocrInfo.error);
      }
    } else {
      console.warn('[kontroller] OCR threw:', ocrResult.reason);
      ocrInfo = { ok: false, error: String(ocrResult.reason?.message || ocrResult.reason) };
    }

    // Fuzzy-match against registered plates to fix character confusions.
    let matchResult = null;
    if (plaka && plaka.length >= 5) {
      try {
        matchResult = await correctOCRGuess(plaka);
        if (matchResult?.corrected && matchResult.corrected !== plaka) {
          plaka = matchResult.corrected;
        }
      } catch (e) {
        console.warn('[kontroller] OCR correction failed:', e.message);
      }
    }

    try {
      const [row] = await db('gunluk_kontroller')
        .insert({
          kontrol_tarihi: todayTR(),
          plaka: plaka || '',
          foto_url: savedFile.value.url,
          yukleyen_user_id: req.user?.id || null,
        })
        .returning('*');
      res.status(201).json({
        kontrol: row,
        ocr: {
          plate: ocrInfo.plate || '',
          confidence: ocrInfo.confidence ?? null,
          strategy: ocrInfo.strategy || null,
          elapsed_ms: ocrInfo.elapsedMs ?? null,
          raw_text: ocrInfo.rawText || '',
          ok: ocrInfo.ok,
          error: ocrInfo.error || null,
          matched_to_registered: matchResult?.corrected ? matchResult.corrected : null,
          match_score: matchResult?.score ?? null,
        },
      });
    } catch (insertErr) {
      next(insertErr);
    }
  });
});

router.patch('/:id/plaka', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newPlaka = normalizePlaka(req.body.plaka || '');
  if (!newPlaka) return res.status(400).json({ error: 'Plaka zorunlu.' });
  const eski = await db('gunluk_kontroller').where({ id }).first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });

  // When the user manually corrects the plate, remember the correction so
  // the next photo with similar OCR output gets fixed automatically.
  if (eski.plaka && eski.plaka !== newPlaka) {
    try {
      await recordLearning(eski.plaka, newPlaka);
    } catch (e) {
      console.warn('Learning record failed:', e.message);
    }
  }

  const [updated] = await db('gunluk_kontroller')
    .where({ id })
    .update({ plaka: newPlaka })
    .returning('*');
  await writeAudit({
    user_id: req.user.id,
    eylem: 'plaka_duzelt',
    tablo_adi: 'gunluk_kontroller',
    kayit_id: id,
    eski_deger: { plaka: eski.plaka },
    yeni_deger: { plaka: newPlaka },
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
