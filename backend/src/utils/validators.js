const DAIRE_NO_REGEX = /^[A-D](?:[1-9]|[12][0-9]|3[0-4])$/;
const TEL_REGEX = /^05[0-9]{9}$/;

const PLAKA_PATTERNS = [
  /^[0-9]{2}[A-Z]{1,3}[0-9]{2,4}$/,
  /^CC[0-9]{4,5}$/,
  /^CD[0-9]{4,5}$/,
  /^G[0-9]{4,5}$/,
  /^M[A-Z]{1,2}[0-9]{3,4}$/,
];

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

function isValidTelefon(t) {
  return typeof t === 'string' && TEL_REGEX.test(t);
}

function parseDaireNo(no) {
  if (!isValidDaireNo(no)) return null;
  return { blok: no[0], sira_no: parseInt(no.slice(1), 10) };
}

module.exports = {
  DAIRE_NO_REGEX,
  TEL_REGEX,
  PLAKA_PATTERNS,
  normalizePlaka,
  isValidDaireNo,
  isValidPlaka,
  isValidTelefon,
  parseDaireNo,
};
