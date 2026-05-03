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

module.exports = { TR_TZ, TZ: TR_TZ, nowTR, todayTR, toTR, isBefore20TR, dayjs };
