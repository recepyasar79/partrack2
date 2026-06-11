/**
 * Login brute-force lockout (Faz 7 güvenlik planı).
 *
 * express-rate-limit'in 5/dk limiti tek başına yetersiz: dakikada 5 deneme
 * = günde 7200 deneme. Bu modül IP başına başarısız denemeleri sayar;
 * MAX_FAILS'e ulaşınca LOCKOUT_MS boyunca o IP'den login reddedilir.
 * Başarılı login sayacı sıfırlar.
 *
 * In-memory (tek instance varsayımı — Fly'da scale-out olursa Redis'e
 * taşınmalı, şimdilik tek makine). Map büyümesin diye her kayıt erişiminde
 * süresi dolanlar temizlenir.
 */

const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000; // sayaç penceresi
const LOCKOUT_MS = 15 * 60 * 1000; // kilit süresi

// key (ip) → { fails: number, firstFailAt: ms, lockedUntil: ms|null }
const _attempts = new Map();

function _now() {
  return Date.now();
}

function _getFresh(key) {
  const rec = _attempts.get(key);
  if (!rec) return null;
  const now = _now();
  // Kilit süresi dolduysa veya pencere dışında kaldıysa kaydı düşür
  if (rec.lockedUntil && rec.lockedUntil <= now) {
    _attempts.delete(key);
    return null;
  }
  if (!rec.lockedUntil && now - rec.firstFailAt > WINDOW_MS) {
    _attempts.delete(key);
    return null;
  }
  return rec;
}

/** @returns {{ locked: boolean, retryAfterSec?: number }} */
function isLocked(key) {
  const rec = _getFresh(key);
  if (rec && rec.lockedUntil) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - _now()) / 1000) };
  }
  return { locked: false };
}

/** Başarısız deneme kaydet. Limit aşılırsa kilidi başlatır. */
function recordFail(key) {
  const now = _now();
  let rec = _getFresh(key);
  if (!rec) {
    rec = { fails: 0, firstFailAt: now, lockedUntil: null };
    _attempts.set(key, rec);
  }
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS && !rec.lockedUntil) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
}

/** Başarılı login — sayacı sıfırla. */
function clearFails(key) {
  _attempts.delete(key);
}

/** Test hook'u. */
function _reset() {
  _attempts.clear();
}

module.exports = { isLocked, recordFail, clearFails, _reset, MAX_FAILS, LOCKOUT_MS, WINDOW_MS };
