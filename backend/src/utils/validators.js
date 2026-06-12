const DAIRE_NO_REGEX = /^[A-D](?:[1-9]|[12][0-9]|3[0-4])$/;
const TEL_REGEX = /^05[0-9]{9}$/;

const PLAKA_PATTERNS = [
  /^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$/,
  /^CC[0-9]{4,5}$/,
  /^CD[0-9]{4,5}$/,
  /^G[0-9]{4,5}$/,
  /^M[A-Z]{1,2}[0-9]{3,4}$/,
];

const RENK_LIST = ['Beyaz', 'Siyah', 'Gri', 'Kırmızı', 'Mavi', 'Yeşil', 'Sarı', 'Kahverengi', 'Diğer'];
const MARKA_LIST = ['Toyota', 'Renault', 'Ford', 'Fiat', 'Volkswagen', 'Hyundai', 'Honda', 'Mercedes', 'BMW', 'Audi', 'Diğer'];

function normalizePlaka(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, '').toUpperCase();
}

function isValidDaireNo(no) {
  return typeof no === 'string' && DAIRE_NO_REGEX.test(no);
}

function isValidPlaka(input) {
  const p = normalizePlaka(input);
  if (!p) return false;
  return PLAKA_PATTERNS.some((re) => re.test(p));
}

// İnsan teyidinden geçen girişler (plaka onaylama/düzeltme, manuel ekleme)
// için esnek kural: sitede yabancı plakalı araçlar var (örn. CB8950HE) ve
// TR desenleri onları reddediyor. Kullanıcı plakayı gözüyle doğruladığı için
// 5-10 alfanümerik + en az 1 harf + 1 rakam yeterli. OCR otomatik akışları
// ve frontend'teki TR ipuçları isValidPlaka (sıkı) ile kalır.
function isValidPlakaSerbest(input) {
  const p = normalizePlaka(input);
  return /^[A-Z0-9]{5,10}$/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);
}

function isValidTelefon(t) {
  return typeof t === 'string' && TEL_REGEX.test(t);
}

function isValidRenk(r) {
  return typeof r === 'string' && RENK_LIST.includes(r);
}

function isValidMarka(m) {
  return typeof m === 'string' && MARKA_LIST.includes(m);
}

function parseDaireNo(no) {
  if (!isValidDaireNo(no)) return null;
  return { blok: no[0], sira_no: parseInt(no.slice(1), 10) };
}

module.exports = {
  DAIRE_NO_REGEX,
  TEL_REGEX,
  PLAKA_PATTERNS,
  RENK_LIST,
  MARKA_LIST,
  normalizePlaka,
  isValidDaireNo,
  isValidPlaka,
  isValidPlakaSerbest,
  isValidTelefon,
  isValidRenk,
  isValidMarka,
  parseDaireNo,
};
