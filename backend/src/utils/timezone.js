const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const TR_TZ = 'Europe/Istanbul';

const nowTR = () => dayjs().tz(TR_TZ);
const todayTR = () => nowTR().format('YYYY-MM-DD');
const toTR = (date) => dayjs(date).tz(TR_TZ);
const isBefore20TR = (d = nowTR()) => d.hour() < 20;

// Gece çetelesi "operasyon günü": takvim gününden farklı olarak sabah
// CETELE_RESET_SAATI'ne (08:00 TR) kadar bir ÖNCEKI güne sayılır. Böylece
// akşam kontrolü (20:00) çetelesi gece yarısında sıfırlanmaz; görevli gece
// 00:30'da baktığında akşamki sayım durur, asıl sıfırlama sabah 08:00'de olur.
const CETELE_RESET_SAATI = 8;
const ceteleGunuTR = (d = nowTR()) =>
  (d.hour() < CETELE_RESET_SAATI ? d.subtract(1, 'day') : d).format('YYYY-MM-DD');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

// Misafir araç başlangıç/bitiş için ISO timestamp döner (TR offset).
// - YYYY-MM-DD: gün başı (false) veya gün sonu (true)
// - YYYY-MM-DDTHH:mm[:ss]: TR saatinde aynen yorumlanır
// - Tam ISO timestamp: aynen geri verilir
function normalizeMisafirZaman(value, isEnd) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (DATE_ONLY_RE.test(s)) {
    const t = isEnd ? '23:59:59' : '00:00:00';
    return dayjs.tz(`${s} ${t}`, TR_TZ).toISOString();
  }
  if (DATETIME_LOCAL_RE.test(s)) {
    const withSec = /:\d{2}:\d{2}$/.test(s) ? s : `${s}:00`;
    return dayjs.tz(withSec.replace('T', ' '), TR_TZ).toISOString();
  }
  const d = dayjs(s);
  return d.isValid() ? d.toISOString() : null;
}

module.exports = { TR_TZ, TZ: TR_TZ, nowTR, todayTR, toTR, isBefore20TR, ceteleGunuTR, CETELE_RESET_SAATI, dayjs, normalizeMisafirZaman };
