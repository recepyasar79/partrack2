export const DAIRE_NO_REGEX = /^[A-D](?:[1-9]|[12][0-9]|3[0-4])$/;
export const TEL_REGEX = /^05[0-9]{9}$/;

const PLAKA_PATTERNS = [
  /^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$/,
  /^CC[0-9]{4,5}$/,
  /^CD[0-9]{4,5}$/,
  /^G[0-9]{4,5}$/,
  /^M[A-Z]{1,2}[0-9]{3,4}$/,
];

export function normalizePlaka(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, '').toUpperCase();
}

export function isValidDaireNo(no) {
  return typeof no === 'string' && DAIRE_NO_REGEX.test(no);
}

export function isValidPlaka(input) {
  const p = normalizePlaka(input);
  if (!p) return false;
  return PLAKA_PATTERNS.some((re) => re.test(p));
}

// İnsan teyidinden geçen girişler (onaylama, manuel ekleme) için esnek kural:
// sitede yabancı plakalı araçlar var (örn. CB8950HE) ve TR desenleri onları
// reddediyor. Kullanıcı plakayı gözüyle doğruladığı için 5-10 alfanümerik +
// en az 1 harf + 1 rakam yeterli; OCR otomatik akışları TR-desenli kalır.
export function isValidPlakaSerbest(input) {
  const p = normalizePlaka(input);
  return /^[A-Z0-9]{5,10}$/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);
}

export function isValidTelefon(t) {
  return typeof t === 'string' && TEL_REGEX.test(t);
}

export function formatTelefon(t) {
  const v = (t || '').replace(/\D/g, '').slice(0, 11);
  if (v.length <= 4) return v;
  if (v.length <= 7) return `${v.slice(0, 4)} ${v.slice(4)}`;
  if (v.length <= 9) return `${v.slice(0, 4)} ${v.slice(4, 7)} ${v.slice(7)}`;
  return `${v.slice(0, 4)} ${v.slice(4, 7)} ${v.slice(7, 9)} ${v.slice(9, 11)}`;
}

export function unformatTelefon(t) {
  return (t || '').replace(/\D/g, '');
}
