/**
 * Plaka Eşleştirme ve Öğrenme Servisi
 * 
 * Backend'de çalışır:
 * 1. OCR çıktısını veritabanındaki kayıtlı plakalarla fuzzy match yapar
 * 2. Kullanıcı onayladığında (plaka düzelttiğinde) öğrenir
 * 3. Bir sonraki sefer aynı OCR çıktısı için öğrenilen düzeltmeyi uygular
 */

const db = require('../db');

// Substitution istatistiği bias hesabı için sabitler.
// 60 gün → yarı ağırlık (exponential decay). Sahada karakter karışıklığı
// pattern'i kamera/aydınlatma değişince eskirse otomatik silinmesin diye
// silmek yerine ağırlığını azaltıyoruz.
const SUBSTITUTION_DECAY_HALF_LIFE_DAYS = 60;
// Bir substitution pattern'i (örn. 1↔L) en fazla bu kadar bonus puan
// verebilir — yoksa hatalı bir öğrenme tek başına yanlış plakaya snap
// edebilir. Levenshtein skoru 100 üzerinden, max 8 bonus güvenli orta yol.
const SUBSTITUTION_MAX_BONUS = 8;

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
 * Aynı uzunluktaki iki plaka arasındaki karakter farklarını döner.
 * Farklı uzunluksa boş dizi — substitution değil ekleme/silme olur.
 * @returns {Array<{from: string, to: string, pos: number}>}
 */
function charDiffs(ocrRaw, correct) {
  const a = (ocrRaw || '').toUpperCase();
  const b = (correct || '').toUpperCase();
  if (!a || !b || a.length !== b.length) return [];
  const diffs = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs.push({ from: a[i], to: b[i], pos: i });
  }
  return diffs;
}

/**
 * Substitution kayıtlarını cache'le (her fuzzy match için DB'yi yormamak için).
 * 60 saniyelik TTL — yeni öğrenme yakında etkili olsun ama her çağrıda
 * select yapmayalım.
 */
let _substitutionCache = null;
let _substitutionCacheAt = 0;
const SUBSTITUTION_CACHE_MS = 60_000;

function clearSubstitutionCache() {
  _substitutionCache = null;
  _substitutionCacheAt = 0;
}

async function getSubstitutionMap() {
  const now = Date.now();
  if (_substitutionCache && now - _substitutionCacheAt < SUBSTITUTION_CACHE_MS) {
    return _substitutionCache;
  }
  let rows = [];
  try {
    rows = await db('plate_char_substitutions').select(
      'from_char', 'to_char', 'count', 'last_seen_at'
    );
  } catch (e) {
    // Tablo henüz migration olmamış olabilir — sessizce devam et
    return new Map();
  }
  const map = new Map();
  for (const r of rows) {
    const key = `${r.from_char}>${r.to_char}`;
    const ageDays = (now - new Date(r.last_seen_at).getTime()) / (24 * 3600 * 1000);
    const decayFactor = Math.pow(0.5, ageDays / SUBSTITUTION_DECAY_HALF_LIFE_DAYS);
    map.set(key, r.count * decayFactor);
  }
  _substitutionCache = map;
  _substitutionCacheAt = now;
  return map;
}

/**
 * Bir fuzzy match adayı için substitution bonusu hesapla.
 * Diffler tutarsa (örn. ocr "1" → registered "L" ve sitede 1↔L sık) bonus.
 *
 * @param {string} ocrRaw   OCR çıktısı (normalized)
 * @param {string} candidate Aday plaka (registered)
 * @param {Map<string,number>} subMap getSubstitutionMap'ten
 * @returns {number} 0..SUBSTITUTION_MAX_BONUS
 */
function substitutionBonus(ocrRaw, candidate, subMap) {
  if (!subMap || subMap.size === 0) return 0;
  const diffs = charDiffs(ocrRaw, candidate);
  if (!diffs.length) return 0;
  let totalWeight = 0;
  for (const d of diffs) {
    const w = subMap.get(`${d.from}>${d.to}`) || 0;
    // log-ölçek: 10 confirm → ~3 puan, 100 confirm → ~5 puan
    if (w > 0) totalWeight += Math.log10(1 + w) * 1.5;
  }
  return Math.min(SUBSTITUTION_MAX_BONUS, totalWeight);
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

  // 1. Exact learning match — fastest path. If we've seen this exact OCR
  // output before and the user corrected it, just use that mapping.
  const exactLearned = await db('plate_learnings')
    .where('ocr_raw', ocrNormalized)
    .first();
  if (exactLearned) {
    return {
      plaka: exactLearned.correct_plaka,
      score: 100,
      source: 'learned-exact',
      confirmCount: exactLearned.confirm_count,
    };
  }

  // 2. Fuzzy match against the union of registered plates and previously
  // learned correct plates. A plate that has been confirmed once becomes
  // part of the "known good" pool for future variants of the same OCR
  // output (e.g. 34MN1089 / 34MNI089 / 34MNT089 all snap to 34MNL089).
  const registeredPlates = await getAllRegisteredPlates();
  const learnedPlates = await db('plate_learnings').select(
    'correct_plaka', 'confirm_count', 'last_confirmed_at'
  );
  const subMap = await getSubstitutionMap();

  let bestMatch = null;
  let bestScore = 0;
  let bestRawScore = 0; // bonus'suz orijinal skor — debug/log için

  for (const plate of registeredPlates) {
    const score = similarityScore(ocrNormalized, plate);
    if (score < minScore) continue;
    // Substitution bonus: site'de sık görülen karakter karışıklığı
    // (örn. 1↔L) bu adayda varsa bonus puan.
    const bonus = substitutionBonus(ocrNormalized, plate, subMap);
    const adjusted = score + bonus;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestRawScore = score;
      bestMatch = {
        plaka: plate,
        score: adjusted,
        rawScore: score,
        substitutionBonus: bonus,
        source: 'fuzzy-registered',
      };
    }
  }

  const nowMs = Date.now();
  for (const row of learnedPlates) {
    const score = similarityScore(ocrNormalized, row.correct_plaka);
    if (score < minScore) continue;
    // Confirm bonus: defalarca onaylanmış öğrenmeler tie'larda kazanır.
    // Eski (30+ gün) onayların ağırlığı yarıya iner — kamera değişimi
    // gibi durumlarda eski pattern'ler birden bire belirleyici olmasın.
    const ageDays = row.last_confirmed_at
      ? (nowMs - new Date(row.last_confirmed_at).getTime()) / (24 * 3600 * 1000)
      : 0;
    const decay = Math.pow(0.5, ageDays / 30);
    const confirmBonus = Math.min(5, (row.confirm_count - 1) * decay);
    const subBonus = substitutionBonus(ocrNormalized, row.correct_plaka, subMap);
    const adjusted = score + confirmBonus + subBonus;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestRawScore = score;
      bestMatch = {
        plaka: row.correct_plaka,
        score: adjusted,
        rawScore: score,
        substitutionBonus: subBonus,
        confirmBonus,
        source: 'fuzzy-learned',
        confirmCount: row.confirm_count,
      };
    }
  }

  return bestMatch;
}

// Yardımcı fonksiyon: Tüm kayıtlı plakaları al
async function getAllRegisteredPlates() {
  const registeredPlates = await db('araclar')
    .select('plaka')
    .where('aktif', true);

  // misafir_araclar has no `aktif` column — bitis_tarihi is the only
  // expiry check. Pull current (date range covers today) entries.
  const today = new Date().toISOString().slice(0, 10);
  const registeredMisafir = await db('misafir_araclar')
    .select('plaka')
    .where('baslangic_tarihi', '<=', today)
    .where('bitis_tarihi', '>=', today);

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
 * Substitution histogramına diffleri yaz. recordLearning'in alt katmanı.
 * UPSERT pattern: yoksa ekle, varsa count++ ve last_seen_at güncelle.
 *
 * Aynı uzunlukta olmayan plakalarda diff yok — Levenshtein insert/delete
 * substitution değil, histograma karıştırmıyoruz.
 */
async function recordSubstitutions(ocrRaw, correct) {
  const diffs = charDiffs(ocrRaw, correct);
  if (!diffs.length) return;

  for (const d of diffs) {
    // Tek karakter ASCII alfanumerik dışında (boşluk, simge) ise atla
    if (!/^[A-Z0-9]$/.test(d.from) || !/^[A-Z0-9]$/.test(d.to)) continue;
    try {
      const existing = await db('plate_char_substitutions')
        .where({ from_char: d.from, to_char: d.to })
        .first();
      if (existing) {
        await db('plate_char_substitutions')
          .where({ id: existing.id })
          .update({
            count: existing.count + 1,
            last_seen_at: db.fn.now(),
          });
      } else {
        await db('plate_char_substitutions').insert({
          from_char: d.from,
          to_char: d.to,
          count: 1,
        });
      }
    } catch (e) {
      // Tablo migration olmamış olabilir — sessizce devam
      console.warn('[plateMatcher] substitution kaydı başarısız:', e.message);
      return;
    }
  }
  clearSubstitutionCache();
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

  // Karakter pattern'ini de histograma yaz — bir sonraki hiç görülmemiş
  // plakada da bu pattern (örn. 1↔L) etkili olabilsin.
  await recordSubstitutions(ocrNormalized, correctNormalized);
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
  getAllLearnings,
  // Substitution histogram API
  charDiffs,
  recordSubstitutions,
  substitutionBonus,
  getSubstitutionMap,
  clearSubstitutionCache,
};
