/**
 * OCR eşleşme güven kararı — Plate Recognizer (PR) fallback'i atlamaya yeter mi?
 *
 * PR ücretli harici API. Yerel OCR'ın eşleşmesi yeterince güvenilirse PR'ı
 * atlayıp maliyetten kaçınırız. Eşikler saha verisiyle kalibre edildi
 * (2026-06-16 akşam batch'i): KAYITLI plakaya snapEligible'dan geçerek
 * eşleşen fuzzy sonuçlar 50/50 %100 doğruydu → güven eşiği 95'ten 80'e indi.
 */

// learned-exact (100) / learned-signature (95) — her kaynaktan güvenilir.
const CACHE_TRUST_THRESHOLD = 95;

// KAYITLI plakaya çapalı kaynaklar (öğrenme havuzu DEĞİL kayıtlı araç kümesi)
// — gece sayımının geçerli cevap kümesi. fuzzy-learned bilerek HARİÇ.
const REGISTERED_TRUST_SOURCES = new Set(['fuzzy-registered', 'raw-registered']);

// Kayıtlı-çapalı fuzzy eşleşme için düşük güven eşiği (saha kalibre).
const FUZZY_TRUST_SCORE = 80;

/**
 * @param {{corrected?: string|null, score?: number|null, source?: string|null}|null} matchResult
 * @returns {boolean} true → PR'ı atla, eşleşmeye güven.
 */
function isMatchTrustedForPRSkip(matchResult) {
  if (!matchResult || !matchResult.corrected) return false;
  const score = matchResult.score ?? 0;
  if (score >= CACHE_TRUST_THRESHOLD) return true;
  return REGISTERED_TRUST_SOURCES.has(matchResult.source) && score >= FUZZY_TRUST_SCORE;
}

module.exports = {
  isMatchTrustedForPRSkip,
  CACHE_TRUST_THRESHOLD,
  REGISTERED_TRUST_SOURCES,
  FUZZY_TRUST_SCORE,
};
