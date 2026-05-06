/**
 * Plaka Eşleştirme ve Öğrenme Servisi
 * 
 * Backend'de çalışır:
 * 1. OCR çıktısını veritabanındaki kayıtlı plakalarla fuzzy match yapar
 * 2. Kullanıcı onayladığında (plaka düzelttiğinde) öğrenir
 * 3. Bir sonraki sefer aynı OCR çıktısı için öğrenilen düzeltmeyi uygular
 */

const db = require('../db');

// Levenshtein mesafesi hesapla
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * İki plaka arasındaki benzerlik skorunu hesapla (0-100)
 */
function similarityScore(a, b) {
  if (a === b) return 100;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;

  const distance = levenshteinDistance(a, b);
  return Math.round((1 - distance / maxLen) * 100);
}

/**
 * OCR çıktısına en yakın kayıtlı plakayı bul
 * ÖNCELİK: 1. Fuzzy match (registered plates) → 2. Learned corrections
 * NEDEN: Gerçek plaka 34YF957 ise fuzzy match bulur, öğrenme tablosu karışmaz
 * @param {string} ocrGuess - OCR'ın okuduğu ham plaka
 * @param {number} minScore - Minimum benzerlik skoru (default 60)
 * @returns {Promise<{plaka: string, score: number, source: string}|null>}
 */
async function findBestMatch(ocrGuess, minScore = 60) {
  if (!ocrGuess || ocrGuess.length < 5) return null;

  const ocrNormalized = ocrGuess.toUpperCase().replace(/\s+/g, '');

  // 1. ÖNCE registered plakalarla fuzzy match yap
  // (Öğrenme tablosundan ÖNCE! Çünkü 34YF957 gerçek plaka olabilir)
  const registeredPlates = await getAllRegisteredPlates();
  
  let bestMatch = null;
  let bestScore = 0;

  for (const plate of registeredPlates) {
    const score = similarityScore(ocrNormalized, plate);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestMatch = { plaka: plate, score, source: 'fuzzy' };
    }
  }

  if (bestMatch) {
    return bestMatch; // Registered plate bulundu, öğrenme tablosuna BAKMA
  }

  // 2. Fuzzy match bulamadıysan, öğrenme tablosuna bak
  const learned = await db('plate_learnings')
    .where('ocr_raw', ocrNormalized)
    .first();

  if (learned) {
    return {
      plaka: learned.correct_plaka,
      score: 100,
      source: 'learned',
      confirmCount: learned.confirm_count
    };
  }

  return null;
}

// Yardımcı fonksiyon: Tüm kayıtlı plakaları al
async function getAllRegisteredPlates() {
  const registeredPlates = await db('araclar')
    .select('plaka')
    .where('aktif', true);

  const registeredMisafir = await db('misafir_araclar')
    .select('plaka')
    .where('aktif', true)
    .whereNull('bitis_tarihi');

  return [
    ...registeredPlates.map(r => r.plaka),
    ...registeredMisafir.map(r => r.plaka)
  ];
}

/**
 * OCR çıktısını düzelt
 * @param {string} ocrGuess - OCR çıktısı
 * @returns {Promise<{original: string, corrected: string|null, source: string, score: number|null}>}
 */
async function correctOCRGuess(ocrGuess) {
  const result = {
    original: ocrGuess,
    corrected: null,
    source: null,
    score: null
  };

  if (!ocrGuess) return result;

  const match = await findBestMatch(ocrGuess);

  if (match) {
    result.corrected = match.plaka;
    result.source = match.source;
    result.score = match.score;
  }

  return result;
}

/**
 * Kullanıcı plaka düzelttiğinde kaydet (öğrenme)
 * @param {string} ocrRaw - OCR'ın okuduğu ham plaka
 * @param {string} correctPlaka - Kullanıcının onayladığı doğru plaka
 */
async function recordLearning(ocrRaw, correctPlaka) {
  if (!ocrRaw || !correctPlaka) return;

  const ocrNormalized = ocrRaw.toUpperCase().replace(/\s+/g, '');
  const correctNormalized = correctPlaka.toUpperCase().replace(/\s+/g, '');

  // Zaten aynıysa kaydetmeye gerek yok
  if (ocrNormalized === correctNormalized) return;

  const existing = await db('plate_learnings')
    .where('ocr_raw', ocrNormalized)
    .first();

  if (existing) {
    // Daha önce öğrenilmiş, doğru plaka değiştiyse güncelle
    if (existing.correct_plaka !== correctNormalized) {
      await db('plate_learnings')
        .where('ocr_raw', ocrNormalized)
        .update({
          correct_plaka: correctNormalized,
          confirm_count: existing.confirm_count + 1,
          last_confirmed_at: db.fn.now()
        });
    } else {
      // Aynı düzeltme tekrarlandı, sadece sayaç artır
      await db('plate_learnings')
        .where('ocr_raw', ocrNormalized)
        .update({
          confirm_count: existing.confirm_count + 1,
          last_confirmed_at: db.fn.now()
        });
    }
  } else {
    // Yeni öğrenme kaydı
    await db('plate_learnings')
      .insert({
        ocr_raw: ocrNormalized,
        correct_plaka: correctNormalized,
        confirm_count: 1
      });
  }
}

/**
 * Birden fazla OCR çıktısını toplu düzelt
 * @param {string[]} ocrGuesses
 * @returns {Promise<Array>}
 */
async function correctBatchOCR(ocrGuesses) {
  const results = [];

  for (const guess of ocrGuesses) {
    const corrected = await correctOCRGuess(guess);
    results.push(corrected);
  }

  return results;
}

/**
 * Öğrenme tablosundaki istatistikleri al
 */
async function getLearningStats() {
  const stats = await db('plate_learnings')
    .select(
      db.raw('COUNT(*) as total_learning'),
      db.raw('SUM(confirm_count) as total_confirms'),
      db.raw('MAX(confirm_count) as max_confirms'),
      db.raw('AVG(confirm_count) as avg_confirms')
    )
    .first();

  const recent = await db('plate_learnings')
    .select('ocr_raw', 'correct_plaka', 'confirm_count', 'last_confirmed_at')
    .orderBy('last_confirmed_at', 'desc')
    .limit(10);

  return { ...stats, recent };
}

/**
 * Belirli bir OCR çıktısının öğrenilip öğrenilmediğini kontrol et
 */
async function isLearned(ocrRaw) {
  const normalized = ocrRaw.toUpperCase().replace(/\s+/g, '');
  const record = await db('plate_learnings')
    .where('ocr_raw', normalized)
    .first();
  return !!record;
}

/**
 * Tüm öğrenme kayıtlarını getir (yönetici için)
 */
async function getAllLearnings() {
  return db('plate_learnings')
    .select('*')
    .orderBy('confirm_count', 'desc')
    .orderBy('last_confirmed_at', 'desc');
}

module.exports = {
  levenshteinDistance,
  similarityScore,
  findBestMatch,
  correctOCRGuess,
  recordLearning,
  correctBatchOCR,
  getLearningStats,
  isLearned,
  getAllLearnings
};
