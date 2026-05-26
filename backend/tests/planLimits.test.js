const {
  DEFAULTS,
  getEffectiveLimits,
  isLimitReached,
  validatePlanLimitsOverride,
} = require('../src/utils/planLimits');

describe('planLimits utility', () => {
  describe('DEFAULTS', () => {
    test('4 plan tanımlı: baslangic, standart, pro, kurumsal', () => {
      expect(Object.keys(DEFAULTS).sort()).toEqual(['baslangic', 'kurumsal', 'pro', 'standart']);
    });

    test('kurumsal sınırsız (null)', () => {
      expect(DEFAULTS.kurumsal.daire_max).toBeNull();
      expect(DEFAULTS.kurumsal.user_max).toBeNull();
    });

    test('baslangic < standart < pro (artan limit)', () => {
      expect(DEFAULTS.baslangic.daire_max).toBeLessThan(DEFAULTS.standart.daire_max);
      expect(DEFAULTS.standart.daire_max).toBeLessThan(DEFAULTS.pro.daire_max);
      expect(DEFAULTS.baslangic.user_max).toBeLessThan(DEFAULTS.standart.user_max);
    });
  });

  describe('getEffectiveLimits', () => {
    test('plan_limits yoksa plan defaults döner', () => {
      const r = getEffectiveLimits({ plan: 'baslangic', plan_limits: null });
      expect(r).toEqual(DEFAULTS.baslangic);
    });

    test('plan_limits boş obj → defaults', () => {
      const r = getEffectiveLimits({ plan: 'standart', plan_limits: {} });
      expect(r).toEqual(DEFAULTS.standart);
    });

    test('override daire_max ezer, user_max default kalır', () => {
      const r = getEffectiveLimits({ plan: 'baslangic', plan_limits: { daire_max: 80 } });
      expect(r.daire_max).toBe(80);
      expect(r.user_max).toBe(DEFAULTS.baslangic.user_max);
    });

    test('override null = sınırsız', () => {
      const r = getEffectiveLimits({ plan: 'baslangic', plan_limits: { daire_max: null } });
      expect(r.daire_max).toBeNull();
    });

    test('bilinmeyen plan → baslangic defaults', () => {
      const r = getEffectiveLimits({ plan: 'fantom', plan_limits: null });
      expect(r).toEqual(DEFAULTS.baslangic);
    });

    test('site null → tüm limitler null', () => {
      expect(getEffectiveLimits(null)).toEqual({ daire_max: null, user_max: null });
    });
  });

  describe('isLimitReached', () => {
    test('limit null → asla dolu (kurumsal)', () => {
      expect(isLimitReached(null, 10000)).toBe(false);
    });

    test('current < limit → false', () => {
      expect(isLimitReached(50, 49)).toBe(false);
    });

    test('current === limit → true (dolu)', () => {
      expect(isLimitReached(50, 50)).toBe(true);
    });

    test('current > limit → true (override sonrası küçülme senaryosu)', () => {
      expect(isLimitReached(50, 75)).toBe(true);
    });
  });

  describe('validatePlanLimitsOverride', () => {
    test('null geçerli (default reset)', () => {
      expect(validatePlanLimitsOverride(null)).toEqual({ ok: true, normalized: null });
    });

    test('boş obj geçerli', () => {
      expect(validatePlanLimitsOverride({})).toEqual({ ok: true, normalized: {} });
    });

    test('geçerli daire_max + user_max', () => {
      const r = validatePlanLimitsOverride({ daire_max: 100, user_max: 10 });
      expect(r.ok).toBe(true);
      expect(r.normalized).toEqual({ daire_max: 100, user_max: 10 });
    });

    test('null değer kabul (sınırsız)', () => {
      const r = validatePlanLimitsOverride({ daire_max: null, user_max: null });
      expect(r.ok).toBe(true);
      expect(r.normalized).toEqual({ daire_max: null, user_max: null });
    });

    test('bilinmeyen anahtar reddedilir', () => {
      const r = validatePlanLimitsOverride({ foto_max: 100 });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('foto_max');
    });

    test('negatif değer reddedilir', () => {
      const r = validatePlanLimitsOverride({ daire_max: -1 });
      expect(r.ok).toBe(false);
    });

    test('float değer reddedilir', () => {
      const r = validatePlanLimitsOverride({ daire_max: 1.5 });
      expect(r.ok).toBe(false);
    });

    test('array reddedilir', () => {
      expect(validatePlanLimitsOverride([1, 2]).ok).toBe(false);
    });

    test('string reddedilir', () => {
      expect(validatePlanLimitsOverride('100').ok).toBe(false);
    });
  });
});
