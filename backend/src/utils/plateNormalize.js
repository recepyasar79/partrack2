/**
 * Plaka normalize signature — cache-first OCR akışının kalbi.
 *
 * Aynı plakanın OCR'dan gelen küçük varyasyonlarını (T↔7, L↔I, O↔0 vb.
 * klasik karakter karışıklıkları) tek bir kanonik string'e indirir.
 * Böylece plate_learnings'te raw_ocr exact match tutmasa bile signature
 * ile cache hit alabiliriz; Plate Recognizer API'sine sadece gerçekten
 * yeni / tanınmayan plakalar için gider.
 *
 * Sınıflar dikkatli seçildi:
 * - Türk plakası 2 rakam + 1-3 harf + 2-4 rakam yapısında. Harf
 *   gövdesinde D, K, M, N gibi harfler sık — bu yüzden D'yi 0 sınıfına
 *   KOYMUYORUZ (yanlış pozitif riski).
 * - 3↔1 confusion'ı saha verisinde gördük (34RL5593 → 14RI5593) ama
 *   optik olarak nadir; class'a katmak agresif olur. Levenshtein
 *   katmanına bırakıyoruz.
 */

const CONFUSION_CLASSES = {
  O: '0', Q: '0', '0': '0',
  I: '1', L: '1', '1': '1',
  T: '7', '7': '7',
  B: '8', '8': '8',
  S: '5', '5': '5',
  Z: '2', '2': '2',
};

/**
 * Plakayı upper-case + non-alnum strip + confusion-class indirgemeye sok.
 * Boş/null girdi için boş string döner.
 * @param {string} plate
 * @returns {string}
 */
function normalizeSignature(plate) {
  if (!plate) return '';
  const upper = String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
  let out = '';
  for (let i = 0; i < upper.length; i++) {
    const c = upper[i];
    out += CONFUSION_CLASSES[c] || c;
  }
  return out;
}

module.exports = { normalizeSignature };
