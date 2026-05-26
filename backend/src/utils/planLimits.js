/**
 * Plan-bazlı kullanım limitleri (Faz Ü2).
 *
 * Limit boyutları:
 *   - daire_max: bir site'de en fazla aktif daire sayısı
 *   - user_max:  bir site'de en fazla aktif kullanıcı (site_yonetici + guvenlik)
 *
 * null değer = sınırsız (kurumsal).
 *
 * Override: sites.plan_limits JSONB kolonu ile per-site eziciler. Eksik
 * anahtarlar DEFAULTS'tan tamamlanır. Superadmin PATCH /api/sites/:id
 * ile özel müşteri için ayarlayabilir.
 */

const DEFAULTS = {
  baslangic: { daire_max: 50,  user_max: 5 },
  standart:  { daire_max: 200, user_max: 20 },
  pro:       { daire_max: 500, user_max: 50 },
  kurumsal:  { daire_max: null, user_max: null },
};

const VALID_PLANS = Object.keys(DEFAULTS);

/**
 * Bir site'nin efektif limitleri: override + plan defaults.
 *
 * @param {{plan: string, plan_limits?: object|null}} site
 * @returns {{daire_max: number|null, user_max: number|null}}
 */
function getEffectiveLimits(site) {
  if (!site) return { daire_max: null, user_max: null };
  const base = DEFAULTS[site.plan] || DEFAULTS.baslangic;
  const override = site.plan_limits || {};
  return {
    daire_max: override.daire_max !== undefined ? override.daire_max : base.daire_max,
    user_max:  override.user_max  !== undefined ? override.user_max  : base.user_max,
  };
}

/**
 * Bir limit'in aşılıp aşılmadığını döner.
 *
 * @param {number|null} limit  Efektif limit (null = sınırsız)
 * @param {number} current     Mevcut sayı
 * @returns {boolean}          true = aşıldı / dolu, false = boş yer var
 */
function isLimitReached(limit, current) {
  if (limit == null) return false;
  return current >= limit;
}

/**
 * plan_limits override objesini validate eder. Yalnız daire_max/user_max
 * anahtarları, integer ≥ 0 veya null. Bilinmeyen anahtar reddedilir.
 *
 * @param {any} input
 * @returns {{ok: true, normalized: object} | {ok: false, error: string}}
 */
function validatePlanLimitsOverride(input) {
  if (input == null) return { ok: true, normalized: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'plan_limits obje olmalı.' };
  }
  const allowed = ['daire_max', 'user_max'];
  const normalized = {};
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      return { ok: false, error: `plan_limits geçersiz anahtar: ${key}` };
    }
    const v = input[key];
    if (v === null) {
      normalized[key] = null;
    } else if (Number.isInteger(v) && v >= 0) {
      normalized[key] = v;
    } else {
      return { ok: false, error: `plan_limits.${key} pozitif tamsayı veya null olmalı.` };
    }
  }
  return { ok: true, normalized };
}

module.exports = {
  DEFAULTS,
  VALID_PLANS,
  getEffectiveLimits,
  isLimitReached,
  validatePlanLimitsOverride,
};
