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
const axios = require('axios');

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

    let plaka = '';
    
    // Python OCR servisine istek at
    try {
      const FormData = require('form-data');
      const form = new FormData();
      
      // multer disk storage kullanıyorsa dosyayı oku
      if (req.file.buffer) {
        form.append('file', req.file.buffer, req.file.originalname || 'plate.jpg');
      } else {
        const fs = require('fs');
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname || 'plate.jpg');
      }
      
      const ocrResponse = await axios.post(
        `${process.env.PYTHON_OCR_URL || 'http://python-ocr:5000'}/ocr`,
        form,
        { headers: { ...form.getHeaders(), 'Content-Type': 'multipart/form-data' } }
      );
      
      if (ocrResponse.data?.plate) {
        plaka = normalizePlaka(ocrResponse.data.plate);
        console.log(`Python OCR result: ${ocrResponse.data.plate} → normalized: ${plaka}`);
      }
    } catch (e) {
      console.warn('Python OCR failed, falling back to Tesseract.js:', e.message);
      // Fallback: use frontend OCR result
      const rawOcrPlaka = (req.body.plaka || '').trim();
      plaka = normalizePlaka(rawOcrPlaka);
    }

    // OCR çıktısını veritabanındaki plakalarla otomatik eşleştir
    let matchResult = null;
    if (plaka && plaka.length >= 5) {
      try {
        matchResult = await correctOCRGuess(plaka);
        if (matchResult?.corrected && matchResult.corrected !== plaka) {
          plaka = matchResult.corrected;
        }
      } catch (e) {
        console.warn('OCR correction failed:', e.message);
      }
    }

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
  const newPlaka = normalizePlaka(req.body.plaka || '');
  if (!newPlaka) return res.status(400).json({ error: 'Plaka zorunlu.' });
  const eski = await db('gunluk_kontroller').where({ id }).first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });

  // Eski plaka ile yeni plaka farklıysa öğren
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
