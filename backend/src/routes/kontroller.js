const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authRequired, requireScopedSite } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { buildUpload, isR2Configured, sniffImageType } = require('../services/storage');
const { todayTR } = require('../utils/timezone');
const { normalizePlaka, isValidPlakaSerbest } = require('../utils/validators');
const { correctOCRGuess, recordLearning } = require('../services/plateMatcher');
const { recognizePlate } = require('../services/pythonOcr');
const plateRecognizer = require('../services/plateRecognizer');
const { recordOcrCall, markCorrected } = require('../services/ocrMetrics');

// Cache-first OCR akışı: bu skor ve üzeri match'lere güvenip Plate
// Recognizer'a gitmiyoruz (API maliyetini tüketmemek için). 95 eşiği
// learned-exact (100) ve learned-signature (95) cache hit'lerini kapsar;
// fuzzy match (60-90 arası) cache miss sayılır.
const CACHE_TRUST_THRESHOLD = 95;

const router = express.Router();
const storage = buildUpload();

// Tüm endpoint'ler için site_id zorunlu
router.use(authRequired, requireScopedSite);

router.get('/', async (req, res) => {
  const tarih = req.query.tarih || todayTR();
  const list = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih, site_id: req.scopedSiteId })
    .orderBy('yukleme_zamani', 'desc');

  // Plaka → daire eşlemesi: önce kayıtlı araç (araclar), o plaka kayıtlı
  // değilse bugün aktif misafir kaydı. Süresi geçmiş misafir (ör. "İlk Kayıt"
  // geçmişi) eşleşmez — sadece bugün geçerli olan daireye yazar.
  const plakalar = [...new Set(list.map((k) => k.plaka).filter(Boolean))];
  const daireByPlaka = {};
  if (plakalar.length) {
    const reg = await db('araclar')
      .join('daireler', 'araclar.daire_id', 'daireler.id')
      .where('araclar.site_id', req.scopedSiteId)
      .andWhere('araclar.aktif', true)
      .whereIn('araclar.plaka', plakalar)
      .select('araclar.plaka', 'daireler.daire_no');
    for (const r of reg) {
      if (!daireByPlaka[r.plaka]) daireByPlaka[r.plaka] = { daire_no: r.daire_no, misafir: false };
    }
    const eksik = plakalar.filter((p) => !daireByPlaka[p]);
    if (eksik.length) {
      const mis = await db('misafir_araclar')
        .join('daireler', 'misafir_araclar.daire_id', 'daireler.id')
        .where('misafir_araclar.site_id', req.scopedSiteId)
        .andWhere('baslangic_tarihi', '<=', tarih)
        .andWhere('bitis_tarihi', '>=', tarih)
        .whereIn('misafir_araclar.plaka', eksik)
        .select('misafir_araclar.plaka', 'daireler.daire_no');
      for (const r of mis) {
        if (!daireByPlaka[r.plaka]) daireByPlaka[r.plaka] = { daire_no: r.daire_no, misafir: true };
      }
    }
  }

  const kontroller = list.map((k) => ({
    ...k,
    foto_url_orig: k.foto_url,
    foto_url: k.foto_url ? `/kontroller/${k.id}/foto` : null,
    daire_no: k.plaka ? (daireByPlaka[k.plaka]?.daire_no ?? null) : null,
    daire_misafir: k.plaka ? (daireByPlaka[k.plaka]?.misafir ?? false) : false,
  }));
  res.json({ tarih, kontroller });
});

router.get('/:id/foto', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const k = await db('gunluk_kontroller')
      .where({ id, site_id: req.scopedSiteId })
      .first();
    if (!k || !k.foto_url) return res.status(404).json({ error: 'Foto bulunamadı.' });

    // Local disk dev fallback.
    if (k.foto_url.startsWith('/uploads/') || !isR2Configured()) {
      const filename = k.foto_url.split('/').pop();
      const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
      const filepath = path.join(uploadDir, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Dosya yok.' });
      return res.sendFile(filepath);
    }

    // Proxy from R2's public URL. We tried the S3 SDK GetObject path first
    // but ran into NoSuchKey errors against the same bucket where PUT
    // succeeded — likely an R2 public-URL/bucket mapping quirk. The public
    // URL is already serving these files (we verified), and we still gate
    // access with authRequired so the proxy keeps the auth boundary.
    const upstream = await fetch(k.foto_url);
    if (!upstream.ok) {
      console.error('[kontroller] foto proxy upstream', upstream.status, k.foto_url);
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Foto yüklenemedi.' });
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const contentLength = upstream.headers.get('content-length');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/foto-upload', (req, res, next) => {
  storage.upload.single('foto')(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Dosya alınamadı.' });

    const buffer = req.file.buffer;
    // İçerik doğrulaması: istemci MIME'ı spoof edilebilir; gerçek tipi
    // magic-byte'tan teyit et (multer fileFilter ucuz ilk kapı olarak kaldı).
    if (!sniffImageType(buffer)) {
      return res.status(400).json({ error: 'Geçersiz veya bozuk görüntü dosyası (yalnız JPG/PNG/WEBP).' });
    }
    const originalName = req.file.originalname || 'plate.jpg';
    const mimeType = req.file.mimetype || 'image/jpeg';
    const siteId = req.scopedSiteId;

    // Run OCR and storage upload in parallel — they don't depend on each other
    // and combined network time is dominated by the slower of the two.
    // Storage'a siteId geçilir → R2 path: sites/{siteId}/kontroller/...
    const [ocrResult, savedFile] = await Promise.allSettled([
      recognizePlate(buffer, { filename: originalName, mimeType }),
      storage.save(buffer, originalName, mimeType, { siteId }),
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

    // Cache-first 4-katmanlı akış:
    //  [1] plate_learnings ham OCR exact match → learned-exact (skor 100)
    //  [2] plate_learnings signature match     → learned-signature (skor 95)
    //  [3] fuzzy match araclar/misafir/learned → fuzzy-* (skor 60-90)
    //  [4] Plate Recognizer cloud API          → cache miss fallback
    //
    // 1+2 yüksek güven → Plate Recognizer'a gitmiyoruz (API maliyeti).
    // 3 ya da hiç match yok → Plate Recognizer'ı dene; başarılı olursa
    // sonucu otomatik plate_learnings'e yaz (bir sonraki sefer cache hit).
    let matchResult = null;
    let usedEngine = ocrInfo.engine || 'easyocr';
    const rawOcrPlate = plaka;

    if (plaka && plaka.length >= 5) {
      try {
        matchResult = await correctOCRGuess(plaka, siteId);
      } catch (e) {
        console.warn('[kontroller] OCR correction failed:', e.message);
      }
    }

    const cacheTrusted = matchResult?.corrected
      && (matchResult.score ?? 0) >= CACHE_TRUST_THRESHOLD;

    if (cacheTrusted) {
      // [1] veya [2] — high-confidence cache hit, Plate Recognizer'a gitme
      plaka = matchResult.corrected;
    } else if (plateRecognizer.isConfigured()) {
      // [3] zayıf fuzzy ya da hiç match yok → Plate Recognizer dene
      const prResult = await plateRecognizer.recognizePlate(buffer, {
        filename: originalName,
        mimeType,
      });
      if (prResult.ok && prResult.plate) {
        const prPlate = normalizePlaka(prResult.plate);
        usedEngine = 'plate_recognizer';

        // PR'ın ham okumasını da kayıtlı listeyle eşleştir. PR plakayı
        // kayıtlı OLMAYAN bir değere okuduysa (örn. 34VK0148 → 36VK6148) ama
        // bu değer kayıtlı bir plakaya yakınsa, kayıtlıya snap'le. Gece
        // sayımında geçerli cevap kümesi kayıtlı plakalar; PR'ın ham çıktısı
        // EasyOCR'ın kayıtlıya yaptığı eşleşmeyi körlemesine ezmemeli.
        let prMatch = null;
        try {
          prMatch = await correctOCRGuess(prPlate, siteId);
        } catch (e) {
          console.warn('[kontroller] PR correction failed:', e.message);
        }
        // correctOCRGuess yalnız kayıtlı/öğrenilmiş kaynaklardan döner
        // (fuzzy-registered / fuzzy-learned / learned-*); corrected varsa
        // bilinen plaka kümesine snap etmiş demektir.
        const prSnapped = prMatch?.corrected;     // PR ciktisi kayitliya snap etti
        const easySnapped = matchResult?.corrected; // EasyOCR ciktisi kayitliya snap etti

        if (prSnapped && easySnapped) {
          // İkisi de kayıtlıya işaret ediyor — yüksek skorlu eşleşmeyi seç.
          matchResult = (prMatch.score >= matchResult.score) ? prMatch : matchResult;
        } else if (prSnapped) {
          matchResult = prMatch;
        } else if (easySnapped) {
          // PR kayıtlı bir plakaya snap edemedi ama EasyOCR etti — kayıtlıyı tut.
          // matchResult zaten EasyOCR'ın kayıtlı eşleşmesi, dokunma.
        } else {
          // İkisi de kayıtlıya snap edemedi → PR'ın ham okumasını kullan
          // (genelde EasyOCR'ın ham çıktısından daha doğru).
          matchResult = {
            original: rawOcrPlate,
            corrected: prPlate,
            source: 'plate-recognizer',
            score: Math.round((prResult.score || 0) * 100),
          };
        }
        plaka = matchResult.corrected;

        // Otomatik öğrenme: ham OCR çıktısı nihai plakadan farklıysa yaz. Bir
        // sonraki aynı ham OCR çıktısında learned-exact cache hit → hem API
        // çağrısı yok hem otomatik onay (örn. 36VK6148 → 34VK0148 öğrenilir).
        if (rawOcrPlate && rawOcrPlate !== plaka) {
          try {
            await recordLearning(rawOcrPlate, plaka, siteId);
          } catch (e) {
            console.warn('[kontroller] auto-learning failed:', e.message);
          }
        }
      } else if (matchResult?.corrected) {
        // Plate Recognizer fail oldu — elimizdeki zayıf fuzzy match'i kullan
        plaka = matchResult.corrected;
      }
    } else if (matchResult?.corrected) {
      // Plate Recognizer konfigüre değil — fuzzy match'i kullan
      plaka = matchResult.corrected;
    }

    try {
      const [row] = await db('gunluk_kontroller')
        .insert({
          kontrol_tarihi: todayTR(),
          plaka: plaka || '',
          foto_url: savedFile.value.url,
          yukleyen_user_id: req.user?.id || null,
          site_id: siteId,
        })
        .returning('*');

      // OCR metric'i async olarak yaz; cevabı bekletme. recordOcrCall
      // kendi hatalarını yutar, kullanıcı akışı etkilenmez. Engine etiketi:
      // Plate Recognizer çağrılıp başarılı olursa 'plate_recognizer',
      // değilse Python servisinden gelen etiket (paddle_det+easyocr / …).
      recordOcrCall({
        gunlukKontrolId: row.id,
        engine: usedEngine,
        ocrResult: ocrInfo,
        siteId,
      });

      // Plaka herhangi bir katmandan çözüldüyse akış kullanıcı açısından
      // başarılıdır — Python OCR'ın timeout/502'sini error olarak göstermek
      // "hata verdi ama plakayı buldu" karmaşası yaratıyordu (2026-06-12 saha
      // testi). Python hatası yalnız hiçbir katman plaka üretemediyse döner;
      // çözülen durumlarda fallback bilgisi ayrı alanda gider.
      const resolved = Boolean(plaka);
      const pythonFailed = !ocrInfo.ok;
      res.status(201).json({
        kontrol: row,
        ocr: {
          plate: ocrInfo.plate || '',
          confidence: ocrInfo.confidence ?? null,
          strategy: ocrInfo.strategy || null,
          elapsed_ms: ocrInfo.elapsedMs ?? null,
          raw_text: ocrInfo.rawText || '',
          ok: resolved || ocrInfo.ok,
          error: resolved ? null : (ocrInfo.error || null),
          fallback_used: resolved && pythonFailed ? usedEngine : null,
          // Eğer kullanıcı düzeltirse fuzzy match plakayı override eder, ama
          // düzeltmedi → düşük confidence varsa frontend manuel onaya çeker.
          needs_manual_review: !!ocrInfo.needsManualReview && !matchResult?.corrected,
          matched_to_registered: matchResult?.corrected ? matchResult.corrected : null,
          match_score: matchResult?.score ?? null,
          // Otomatik onay kararı için eşleşme kaynağı: learned-exact /
          // learned-signature / fuzzy-registered / fuzzy-learned /
          // plate-recognizer. Fuzzy skoru PR skoruyla çakışabildiği için
          // frontend skoru tek başına kullanamaz.
          match_source: matchResult?.source ?? null,
        },
      });
    } catch (insertErr) {
      next(insertErr);
    }
  });
});

// Manuel plaka girişi — foto çekilemeyen durumlar için (kapalı otopark
// köşesi, kirli/okunamayan plaka vs.). Foto olmadan kontrol kaydı oluşturur;
// akşam analizine normal kayıt gibi dahil olur.
router.post('/manuel', async (req, res, next) => {
  try {
    const plaka = normalizePlaka(req.body.plaka || '');
    if (!isValidPlakaSerbest(plaka)) {
      return res.status(400).json({ error: 'Plaka formatı geçersiz.' });
    }
    const [row] = await db('gunluk_kontroller')
      .insert({
        kontrol_tarihi: todayTR(),
        plaka,
        foto_url: null,
        yukleyen_user_id: req.user?.id || null,
        site_id: req.scopedSiteId,
      })
      .returning('*');
    await writeAudit({
      user_id: req.user.id,
      site_id: req.scopedSiteId,
      eylem: 'manuel_plaka_ekle',
      tablo_adi: 'gunluk_kontroller',
      kayit_id: row.id,
      yeni_deger: { plaka },
      ip_adres: req.ip,
    });
    res.status(201).json({ kontrol: row });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/plaka', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newPlaka = normalizePlaka(req.body.plaka || '');
  if (!newPlaka) return res.status(400).json({ error: 'Plaka zorunlu.' });
  if (!isValidPlakaSerbest(newPlaka)) {
    return res.status(400).json({ error: 'Plaka formatı geçersiz.' });
  }
  const eski = await db('gunluk_kontroller')
    .where({ id, site_id: req.scopedSiteId })
    .first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });

  // When the user manually corrects the plate, remember the correction so
  // the next photo with similar OCR output gets fixed automatically.
  if (eski.plaka && eski.plaka !== newPlaka) {
    try {
      await recordLearning(eski.plaka, newPlaka, req.scopedSiteId);
    } catch (e) {
      console.warn('Learning record failed:', e.message);
    }
  }

  // OCR metric'inde "kullanıcı düzeltti" işareti — sahip olduğumuz tek
  // ground-truth sinyali. Doğruluk hesabı buna dayanıyor.
  if (eski.plaka !== newPlaka) {
    markCorrected(id, newPlaka);
  }

  const [updated] = await db('gunluk_kontroller')
    .where({ id, site_id: req.scopedSiteId })
    .update({ plaka: newPlaka })
    .returning('*');
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
    eylem: 'plaka_duzelt',
    tablo_adi: 'gunluk_kontroller',
    kayit_id: id,
    eski_deger: { plaka: eski.plaka },
    yeni_deger: { plaka: newPlaka },
    ip_adres: req.ip,
  });
  res.json({ kontrol: updated });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const eski = await db('gunluk_kontroller')
    .where({ id, site_id: req.scopedSiteId })
    .first();
  if (!eski) return res.status(404).json({ error: 'Kontrol bulunamadı.' });
  await db('gunluk_kontroller')
    .where({ id, site_id: req.scopedSiteId })
    .delete();
  await writeAudit({
    user_id: req.user.id,
    site_id: req.scopedSiteId,
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
