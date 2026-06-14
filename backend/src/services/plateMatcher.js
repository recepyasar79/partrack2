/**
 * Plaka Eşleştirme ve Öğrenme Servisi
 * 
 * Backend'de çalışır:
 * 1. OCR çıktısını veritabanındaki kayıtlı plakalarla fuzzy match yapar
 * 2. Kullanıcı onayladığında (plaka düzelttiğinde) öğrenir
 * 3. Bir sonraki sefer aynı OCR çıktısı için öğrenilen düzeltmeyi uygular
 */

const db = require('../db');
const { normalizeSignature } = require('../utils/plateNormalize');

// Substitution istatistiği bias hesabı için sabitler.
// 60 gün → yarı ağırlık (exponential decay). Sahada karakter karışıklığı
// pattern'i kamera/aydınlatma değişince eskirse otomatik silinmesin diye
// silmek yerine ağırlığını azaltıyoruz.
const SUBSTITUTION_DECAY_HALF_LIFE_DAYS = 60;
// Bir substitution pattern'i (örn. 1↔L) en fazla bu kadar bonus puan
// verebilir — yoksa hatalı bir öğrenme tek başına yanlış plakaya snap
// edebilir. Levenshtein skoru 100 üzerinden, max 8 bonus güvenli orta yol.
const SUBSTITUTION_MAX_BONUS = 8;

// Yerleşik optik karışma grupları — site bu pattern'i daha önce öğrenmemiş
// olsa bile fuzzy match'te modest bonus verir, kayıtlı plakaya snap için.
// Saha verisi (2026-06-13): O↔D ve D↔0 karışması gözlendi. D, signature
// sınıfının (plateNormalize.js) DIŞINDA bırakılmıştı (yanlış-pozitif riski);
// burada signature'ı değil yalnız Levenshtein bonusunu etkiliyoruz — yazarın
// "nadir confusion'ları Levenshtein katmanına bırak" notuyla tutarlı. Bonus
// üst sınırı (8) çok benzer iki kayıtlı plakanın yanlış snap'ini engeller.
const BUILTIN_CONFUSABLE_GROUPS = [
  ['O', '0', 'Q', 'D'],
  ['I', '1', 'L'],
  ['T', '7'],
  ['B', '8'],
  ['S', '5'],
  ['Z', '2'],
  ['A', '4'],
  ['G', '6'],
];
const _confusableKeyByChar = {};
for (const grup of BUILTIN_CONFUSABLE_GROUPS) {
  for (const ch of grup) _confusableKeyByChar[ch] = grup[0];
}
function isConfusablePair(a, b) {
  return Boolean(_confusableKeyByChar[a]) && _confusableKeyByChar[a] === _confusableKeyByChar[b];
}
// Yerleşik confusable diff başına bonus (öğrenilmiş pattern'den düşük; o
// gerçek saha kanıtı, bu sadece optik öncül).
const BUILTIN_CONFUSABLE_BONUS_PER_DIFF = 2.5;

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
 * select yapmayalım. Multi-tenant'ta cache site_id başına bölünür.
 */
const SUBSTITUTION_CACHE_MS = 60_000;

// Multi-tenant: cache key olarak site_id kullan. Her sitenin substitution
// histogramı bağımsız — site A'nın "L↔I" pattern'i site B'yi etkilemez.
const _substitutionCacheBySite = new Map(); // siteId → { map, at }

function clearSubstitutionCache() {
  _substitutionCacheBySite.clear();
}

async function getSubstitutionMap(siteId) {
  if (siteId == null) return new Map();
  const now = Date.now();
  const cached = _substitutionCacheBySite.get(siteId);
  if (cached && now - cached.at < SUBSTITUTION_CACHE_MS) {
    return cached.map;
  }
  let rows = [];
  try {
    rows = await db('plate_char_substitutions')
      .where({ site_id: siteId })
      .select('from_char', 'to_char', 'count', 'last_seen_at');
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
  _substitutionCacheBySite.set(siteId, { map, at: now });
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
  const diffs = charDiffs(ocrRaw, candidate);
  if (!diffs.length) return 0;
  let totalWeight = 0;
  for (const d of diffs) {
    const w = subMap ? (subMap.get(`${d.from}>${d.to}`) || 0) : 0;
    if (w > 0) {
      // Site'nin öğrendiği pattern (gerçek saha kanıtı) — log-ölçek:
      // 10 confirm → ~3 puan, 100 confirm → ~5 puan.
      totalWeight += Math.log10(1 + w) * 1.5;
    } else if (isConfusablePair(d.from, d.to)) {
      // Henüz öğrenilmemiş ama yerleşik optik karışma (O↔D, D↔0, I↔1 vb.).
      totalWeight += BUILTIN_CONFUSABLE_BONUS_PER_DIFF;
    }
  }
  return Math.min(SUBSTITUTION_MAX_BONUS, totalWeight);
}

/**
 * OCR çıktısına en yakın kayıtlı plakayı bul.
 * Multi-tenant: tüm sorgular site_id ile filtrelenir. siteId zorunlu —
 * eksikse null döner (yanlışlıkla cross-site leak'i önler).
 *
 * @param {string} ocrGuess - OCR'ın okuduğu ham plaka
 * @param {number} siteId - Kullanıcının site'si
 * @param {number} minScore - Minimum benzerlik skoru (default 60)
 * @returns {Promise<{plaka: string, score: number, source: string}|null>}
 */
async function findBestMatch(ocrGuess, siteId, minScore = 60) {
  if (!ocrGuess || ocrGuess.length < 5) return null;
  if (siteId == null) return null;

  const ocrNormalized = ocrGuess.toUpperCase().replace(/\s+/g, '');

  // 1. Exact learning match — fastest path. If we've seen this exact OCR
  // output before and the user corrected it, just use that mapping.
  const exactLearned = await db('plate_learnings')
    .where({ ocr_raw: ocrNormalized, site_id: siteId })
    .first();
  if (exactLearned) {
    return {
      plaka: exactLearned.correct_plaka,
      score: 100,
      source: 'learned-exact',
      confirmCount: exactLearned.confirm_count,
    };
  }

  // 2. Signature match — ham OCR aynen tutmadı ama karakter karışıklık
  // sınıflarına (O/0, I/L/1, T/7 vb.) indirgenmiş hali daha önce
  // görüldüyse onu kullan. Bu Plate Recognizer'a gitmeden önceki son
  // local hamle; cache hit rate'ini ciddi artırıyor.
  const signature = normalizeSignature(ocrNormalized);
  if (signature) {
    const signatureMatch = await db('plate_learnings')
      .where({ normalize_signature: signature, site_id: siteId })
      .orderBy('confirm_count', 'desc')
      .orderBy('last_confirmed_at', 'desc')
      .first();
    if (signatureMatch) {
      return {
        plaka: signatureMatch.correct_plaka,
        score: 95, // exact'in altında ama fuzzy'nin üzerinde — net cache hit
        source: 'learned-signature',
        confirmCount: signatureMatch.confirm_count,
      };
    }
  }

  // 3. Fuzzy match against the union of registered plates and previously
  // learned correct plates. A plate that has been confirmed once becomes
  // part of the "known good" pool for future variants of the same OCR
  // output (e.g. 34MN1089 / 34MNI089 / 34MNT089 all snap to 34MNL089).
  const registeredPlates = await getAllRegisteredPlates(siteId);
  const learnedPlates = await db('plate_learnings')
    .where({ site_id: siteId })
    .select('correct_plaka', 'confirm_count', 'last_confirmed_at');
  const subMap = await getSubstitutionMap(siteId);

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

// Yardımcı fonksiyon: site bazında tüm kayıtlı plakaları al
async function getAllRegisteredPlates(siteId) {
  if (siteId == null) return [];
  const registeredPlates = await db('araclar')
    .where({ site_id: siteId, aktif: true })
    .select('plaka');

  // misafir_araclar has no `aktif` column — bitis_tarihi is the only
  // expiry check. Pull current (date range covers today) entries.
  const today = new Date().toISOString().slice(0, 10);
  const registeredMisafir = await db('misafir_araclar')
    .where({ site_id: siteId })
    .where('baslangic_tarihi', '<=', today)
    .where('bitis_tarihi', '>=', today)
    .select('plaka');

  return [
    ...registeredPlates.map(r => r.plaka),
    ...registeredMisafir.map(r => r.plaka)
  ];
}

/**
 * Plakanın [il kodu, harfler, rakam] bloklarının olası dizilişlerini üret.
 * OCR eğik/yakın çekimde blokları farklı sırada okuyabiliyor — saha örnekleri:
 *   "729 PEL 34"  (rakam-harf-il)   → 34PEL729
 *   "825 34NTM"   (rakam-il-harf)   → 34NTM825
 *   "DLN932 34"   (harf-rakam-il)   → 34DLN932
 * Ham metinde plakayı blok sırasından bağımsız yakalamak için tüm dizilişler
 * (6 kısa form) pencere taramasıyla aranır.
 * @returns {string[]}
 */
function plateOrderForms(plate) {
  const forms = new Set([plate]);
  const m = /^(\d{2})([A-Z]{1,3})(\d{2,4})$/.exec(plate);
  if (m) {
    const b = [m[1], m[2], m[3]]; // [il kodu, harfler, rakam]
    // [0,1,2] (normal) zaten set'te; kalan 5 diziliş:
    const orders = [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const [i, j, k] of orders) forms.add(b[i] + b[j] + b[k]);
  } else {
    // Standart desen değil (diplomatik vb.) → en azından province-sona formu.
    const m2 = /^(\d{2})([A-Z][A-Z0-9]*)$/.exec(plate);
    if (m2) forms.add(`${m2[2]}${m2[1]}`);
  }
  return [...forms];
}

/**
 * `form`'u `rawNorm` içinde kaydırarak en iyi pencere benzerliğini bul.
 * Tek ekleme/silme toleransı için form uzunluğunun ±1'i de denenir.
 */
function bestWindowScore(rawNorm, form) {
  if (!form || form.length < 4) return 0;
  if (form.length >= rawNorm.length) return similarityScore(rawNorm, form);
  let best = 0;
  for (let len = form.length - 1; len <= form.length + 1; len++) {
    if (len < 4 || len > rawNorm.length) continue;
    for (let i = 0; i + len <= rawNorm.length; i++) {
      const s = similarityScore(rawNorm.slice(i, i + len), form);
      if (s > best) {
        best = s;
        if (best === 100) return 100;
      }
    }
  }
  return best;
}

/**
 * Ham OCR metninde (yalnız çıkarılan tek plaka değil) kayıtlı bir plaka ara.
 * extract_plate yanlış substring seçip matcher'ı yanlış kayıtlıya snaplettiğinde
 * (saha: ham "DLN932 34 TR" → çıkarılan "34TR14" → yanlış kayıtlı 34CTM124),
 * doğru plaka ("DLN932 34") çoğu zaman ham metinde duruyor. Yüksek eşik (88):
 * plakanın ham içinde neredeyse birebir geçmesini isteriz — 3 harf + 3-4 rakam
 * gövdesi ayırt edici olduğu için yanlış-pozitif riski düşük.
 *
 * @param {string} rawText - Python OCR ham metni (boşluklu, çok token'lı)
 * @param {number} siteId
 * @param {number} minScore
 * @returns {Promise<{plaka: string, score: number, source: string}|null>}
 */
async function findBestMatchFromRaw(rawText, siteId, minScore = 88) {
  if (!rawText || siteId == null) return null;
  const rawNorm = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (rawNorm.length < 5) return null;

  const registeredPlates = await getAllRegisteredPlates(siteId);
  let best = null;
  for (const plate of registeredPlates) {
    let plateBest = 0;
    for (const form of plateOrderForms(plate)) {
      const s = bestWindowScore(rawNorm, form);
      if (s > plateBest) plateBest = s;
    }
    if (plateBest >= minScore && (!best || plateBest > best.score)) {
      best = { plaka: plate, score: plateBest, source: 'raw-registered' };
    }
  }
  return best;
}

/**
 * OCR çıktısını düzelt — site_id zorunlu.
 * @param {string} ocrGuess - OCR'ın çıkardığı tek plaka tahmini
 * @param {number} siteId   - Kullanıcının site'si
 * @param {string} [rawText] - Python OCR ham metni (tüm token'lar). Verilirse,
 *   çıkarılan tek plaka yanlış olduğunda ham metinde kayıtlı plaka aranır.
 * @returns {Promise<{original: string, corrected: string|null, source: string, score: number|null}>}
 */
async function correctOCRGuess(ocrGuess, siteId, rawText = null) {
  const result = {
    original: ocrGuess,
    corrected: null,
    source: null,
    score: null
  };

  if (!ocrGuess && !rawText) return result;

  const match = ocrGuess ? await findBestMatch(ocrGuess, siteId) : null;

  // Ham metinde kayıtlı plaka neredeyse birebir geçiyorsa, bozuk tek-token'ın
  // fuzzy snap'inden daha güvenilirdir. Yalnız KESİN daha iyiyse (strictly
  // greater) override edilir — eşitlik/normal durumda mevcut davranış korunur.
  let rawMatch = null;
  if (rawText) {
    try {
      rawMatch = await findBestMatchFromRaw(rawText, siteId);
    } catch (e) {
      // raw-match opsiyonel iyileştirme; hata olursa normal akış sürsün
    }
  }

  const chosen = (rawMatch && (!match || rawMatch.score > match.score)) ? rawMatch : match;

  if (chosen) {
    result.corrected = chosen.plaka;
    result.source = chosen.source;
    result.score = chosen.score;
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
async function recordSubstitutions(ocrRaw, correct, siteId) {
  if (siteId == null) return;
  const diffs = charDiffs(ocrRaw, correct);
  if (!diffs.length) return;

  for (const d of diffs) {
    // Tek karakter ASCII alfanumerik dışında (boşluk, simge) ise atla
    if (!/^[A-Z0-9]$/.test(d.from) || !/^[A-Z0-9]$/.test(d.to)) continue;
    try {
      const existing = await db('plate_char_substitutions')
        .where({ from_char: d.from, to_char: d.to, site_id: siteId })
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
          site_id: siteId,
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
 * Kullanıcı plaka düzelttiğinde kaydet (öğrenme) — site_id zorunlu.
 * @param {string} ocrRaw - OCR'ın okuduğu ham plaka
 * @param {string} correctPlaka - Kullanıcının onayladığı doğru plaka
 * @param {number} siteId - Kullanıcının site'si
 */
async function recordLearning(ocrRaw, correctPlaka, siteId) {
  if (!ocrRaw || !correctPlaka) return;
  if (siteId == null) return;

  const ocrNormalized = ocrRaw.toUpperCase().replace(/\s+/g, '');
  const correctNormalized = correctPlaka.toUpperCase().replace(/\s+/g, '');

  // Zaten aynıysa kaydetmeye gerek yok
  if (ocrNormalized === correctNormalized) return;

  // KRİTİK: Öğrenme havuzu yalnız BİLİNEN-İYİ (kayıtlı) plakaları içermeli.
  // correct_plaka kayıtlı araç ya da bugün aktif misafir değilse kaydetme.
  // Aksi halde OCR/PR'ın kayıtsız bir yanlış-okuması (örn. 34VK0148 → 36VK6148)
  // "doğru" diye öğrenilir; sonraki okumalarda learned-exact ile bu kayıtsız
  // plakaya snap eder ve gerçek kayıtlı plakaya ulaşmayı kalıcı olarak engeller
  // (havuz zehirlenmesi — sahada 289 öğrenmenin 36'sı bu şekilde bozulmuştu).
  const registered = await getAllRegisteredPlates(siteId);
  const regSet = new Set(registered.map((p) => p.toUpperCase().replace(/\s+/g, '')));
  if (!regSet.has(correctNormalized)) {
    return;
  }

  const signature = normalizeSignature(ocrNormalized);

  const existing = await db('plate_learnings')
    .where({ ocr_raw: ocrNormalized, site_id: siteId })
    .first();

  if (existing) {
    // Daha önce öğrenilmiş, doğru plaka değiştiyse güncelle
    if (existing.correct_plaka !== correctNormalized) {
      await db('plate_learnings')
        .where({ id: existing.id })
        .update({
          correct_plaka: correctNormalized,
          confirm_count: existing.confirm_count + 1,
          last_confirmed_at: db.fn.now(),
          normalize_signature: signature,
        });
    } else {
      // Aynı düzeltme tekrarlandı, sadece sayaç artır
      await db('plate_learnings')
        .where({ id: existing.id })
        .update({
          confirm_count: existing.confirm_count + 1,
          last_confirmed_at: db.fn.now(),
          normalize_signature: signature,
        });
    }
  } else {
    // Yeni öğrenme kaydı
    await db('plate_learnings')
      .insert({
        ocr_raw: ocrNormalized,
        correct_plaka: correctNormalized,
        confirm_count: 1,
        normalize_signature: signature,
        site_id: siteId,
      });
  }

  // Karakter pattern'ini de histograma yaz — bir sonraki hiç görülmemiş
  // plakada da bu pattern (örn. 1↔L) etkili olabilsin.
  await recordSubstitutions(ocrNormalized, correctNormalized, siteId);
}

/**
 * Birden fazla OCR çıktısını toplu düzelt
 * @param {string[]} ocrGuesses
 * @param {number} siteId
 * @returns {Promise<Array>}
 */
async function correctBatchOCR(ocrGuesses, siteId) {
  const results = [];

  for (const guess of ocrGuesses) {
    const corrected = await correctOCRGuess(guess, siteId);
    results.push(corrected);
  }

  return results;
}

/**
 * Öğrenme tablosundaki istatistikleri al — site bazında
 */
async function getLearningStats(siteId) {
  if (siteId == null) return { total_learning: 0, recent: [] };
  const stats = await db('plate_learnings')
    .where({ site_id: siteId })
    .select(
      db.raw('COUNT(*) as total_learning'),
      db.raw('SUM(confirm_count) as total_confirms'),
      db.raw('MAX(confirm_count) as max_confirms'),
      db.raw('AVG(confirm_count) as avg_confirms')
    )
    .first();

  const recent = await db('plate_learnings')
    .where({ site_id: siteId })
    .select('ocr_raw', 'correct_plaka', 'confirm_count', 'last_confirmed_at')
    .orderBy('last_confirmed_at', 'desc')
    .limit(10);

  return { ...stats, recent };
}

/**
 * Belirli bir OCR çıktısının öğrenilip öğrenilmediğini kontrol et
 */
async function isLearned(ocrRaw, siteId) {
  if (siteId == null) return false;
  const normalized = ocrRaw.toUpperCase().replace(/\s+/g, '');
  const record = await db('plate_learnings')
    .where({ ocr_raw: normalized, site_id: siteId })
    .first();
  return !!record;
}

/**
 * Tüm öğrenme kayıtlarını getir (yönetici için) — site bazında
 */
async function getAllLearnings(siteId) {
  if (siteId == null) return [];
  return db('plate_learnings')
    .where({ site_id: siteId })
    .select('*')
    .orderBy('confirm_count', 'desc')
    .orderBy('last_confirmed_at', 'desc');
}

module.exports = {
  levenshteinDistance,
  similarityScore,
  findBestMatch,
  findBestMatchFromRaw,
  plateOrderForms,
  bestWindowScore,
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
