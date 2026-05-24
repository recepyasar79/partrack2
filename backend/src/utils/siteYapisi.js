/**
 * Site blok yapısı yardımcıları — sites.blok_yapisi JSONB kolonu ile çalışır.
 *
 * Format:
 *   [{ ad: "A", daire_sayisi: 34 }, { ad: "B", daire_sayisi: 34 }, ...]
 *
 * Site oluşturulurken bu yapı kaydedilir; daire ekleme/güncelleme bu
 * yapıya göre doğrulanır.
 */

const BLOK_AD_REGEX = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü .-]{1,16}$/;
const MAX_BLOK = 26;
const MAX_DAIRE_PER_BLOK = 200;

/**
 * Blok yapısı geçerli mi? Validate ediyor:
 *   - Array
 *   - 1-26 blok arası
 *   - Her blokta ad (string) ve daire_sayisi (1-200) var
 *   - Blok adları unique (case-insensitive)
 *
 * @param {unknown} blokYapisi
 * @returns {{ok: true, normalized: Array}|{ok: false, error: string}}
 */
function validateBlokYapisi(blokYapisi) {
  if (!Array.isArray(blokYapisi)) {
    return { ok: false, error: 'blok_yapisi bir dizi olmalı.' };
  }
  if (blokYapisi.length === 0) {
    return { ok: false, error: 'En az 1 blok zorunlu.' };
  }
  if (blokYapisi.length > MAX_BLOK) {
    return { ok: false, error: `En fazla ${MAX_BLOK} blok olabilir.` };
  }
  const seenAds = new Set();
  const normalized = [];
  for (let i = 0; i < blokYapisi.length; i++) {
    const b = blokYapisi[i];
    if (!b || typeof b !== 'object') {
      return { ok: false, error: `Blok ${i + 1} geçersiz format.` };
    }
    const ad = String(b.ad || '').trim();
    if (!ad || !BLOK_AD_REGEX.test(ad)) {
      return { ok: false, error: `Blok ${i + 1} adı geçersiz: "${ad}"` };
    }
    const lowerAd = ad.toLowerCase();
    if (seenAds.has(lowerAd)) {
      return { ok: false, error: `Blok adı çakışıyor: "${ad}"` };
    }
    seenAds.add(lowerAd);
    const daireSayisi = parseInt(b.daire_sayisi, 10);
    if (!Number.isInteger(daireSayisi) || daireSayisi < 1 || daireSayisi > MAX_DAIRE_PER_BLOK) {
      return { ok: false, error: `Blok "${ad}" daire sayısı 1-${MAX_DAIRE_PER_BLOK} arası olmalı.` };
    }
    normalized.push({ ad, daire_sayisi: daireSayisi });
  }
  return { ok: true, normalized };
}

/**
 * Hızlı yapı üretici: blok sayısı + her blokta daire sayısı verince
 * A, B, C, ... şeklinde otomatik adlandırılmış blok yapısı dön.
 * 26'dan fazla blok varsa AA, AB... (Excel kolon mantığı).
 *
 * @param {number} blokSayisi
 * @param {number} dairePerBlok
 * @returns {Array<{ad: string, daire_sayisi: number}>}
 */
function buildUniformBlokYapisi(blokSayisi, dairePerBlok) {
  const out = [];
  for (let i = 0; i < blokSayisi; i++) {
    out.push({ ad: indexToBlokAd(i), daire_sayisi: dairePerBlok });
  }
  return out;
}

function indexToBlokAd(i) {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * Bir daire_no (örn. "A12") veya {blok, sira_no} site'nin blok_yapisi'na
 * göre geçerli mi?
 *
 * @param {{blok: string, sira_no: number|string}} daire
 * @param {Array} blokYapisi - sites.blok_yapisi
 */
function isValidDaireInSite(daire, blokYapisi) {
  if (!daire || !Array.isArray(blokYapisi)) return false;
  const blok = String(daire.blok || '').trim();
  const sira = parseInt(daire.sira_no, 10);
  if (!blok || !Number.isInteger(sira)) return false;
  const def = blokYapisi.find((b) => b.ad.toLowerCase() === blok.toLowerCase());
  if (!def) return false;
  return sira >= 1 && sira <= def.daire_sayisi;
}

/**
 * "A12" gibi bir string'i {blok, sira_no} olarak parse et.
 * Blok kısmı harf/Türkçe karakter, sıra kısmı rakam.
 *
 * @param {string} daireNo
 * @returns {{blok: string, sira_no: number}|null}
 */
function parseDaireNoFlexible(daireNo) {
  if (!daireNo) return null;
  const m = String(daireNo).trim().match(/^([A-Za-zÇĞİÖŞÜçğıöşü .-]+?)\s*-?\s*(\d+)$/);
  if (!m) return null;
  return { blok: m[1].trim(), sira_no: parseInt(m[2], 10) };
}

module.exports = {
  validateBlokYapisi,
  buildUniformBlokYapisi,
  indexToBlokAd,
  isValidDaireInSite,
  parseDaireNoFlexible,
  MAX_BLOK,
  MAX_DAIRE_PER_BLOK,
};
