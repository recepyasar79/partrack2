/**
 * Site slug üretici — multi-tenant login'de site identifier olarak kullanılır.
 *
 * Tasarım:
 *   - 10 karakter (31^10 ≈ 8×10^14 kombinasyon, brute force imkansız)
 *   - Karışabilen karakterler hariç: l/1/I, O/0 — site sakini elden yazınca
 *     yanlış yazmasın
 *   - Sadece küçük harf + rakam: case-insensitive konuşma kolay
 *
 * Çakışma olasılığı 1M site'de ≈ 10^-9; yine de POST endpoint çakışma
 * görürse retry yapmalı (caller responsibility).
 */
const crypto = require('crypto');

// l, 1, I, O, 0 hariç
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ALPHABET_LEN = ALPHABET.length; // 31

/**
 * Kriptografik olarak güvenli rastgele 10 karakterli slug üretir.
 * @returns {string}
 */
function generateSiteSlug() {
  // crypto.randomBytes ile uniform rastgele byte → modulo bias kontrolü.
  // ALPHABET_LEN=31 256'yı tam bölmediği için 256/31=8.25 → 256%31=8 byte
  // bias riski var. Bias'ı eliminemek için reject sampling: byte ≥ 248
  // (8*31) ise atıp yeniden çek.
  const out = [];
  while (out.length < 10) {
    const buf = crypto.randomBytes(16);
    for (let i = 0; i < buf.length && out.length < 10; i++) {
      const b = buf[i];
      if (b >= 248) continue; // reject (8*31=248)
      out.push(ALPHABET[b % ALPHABET_LEN]);
    }
  }
  return out.join('');
}

module.exports = { generateSiteSlug, ALPHABET };
