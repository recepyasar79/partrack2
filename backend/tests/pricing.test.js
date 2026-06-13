const {
  TAX_RATE, YEARLY_DISCOUNT, MONTHLY_PRICES,
  getBaseAmount, calculateTotal, prorateChange, formatInvoiceNo, isPaidPlan,
} = require('../src/utils/pricing');

describe('pricing.getBaseAmount', () => {
  test('baslangic ücretsiz (0)', () => {
    expect(getBaseAmount('baslangic', 'monthly')).toBe(0);
    expect(getBaseAmount('baslangic', 'yearly')).toBe(0);
  });

  test('standart aylık 99900 kuruş', () => {
    expect(getBaseAmount('standart', 'monthly')).toBe(99900);
  });

  test('standart yıllık = aylık × 12 × 0.8', () => {
    // 99900 × 12 × 0.8 = 959040 kuruş
    expect(getBaseAmount('standart', 'yearly')).toBe(959040);
  });

  test('pro yıllıkta da %20 indirim', () => {
    const monthly = MONTHLY_PRICES.pro;
    const yearly = getBaseAmount('pro', 'yearly');
    expect(yearly).toBe(Math.floor(monthly * 12 * 0.8));
  });

  test('kurumsal null (özel anlaşma)', () => {
    expect(getBaseAmount('kurumsal', 'monthly')).toBeNull();
    expect(getBaseAmount('kurumsal', 'yearly')).toBeNull();
  });

  test('geçersiz plan null', () => {
    expect(getBaseAmount('fantom', 'monthly')).toBeNull();
  });
});

describe('pricing.calculateTotal', () => {
  test('0 kuruş için KDV de 0', () => {
    const r = calculateTotal(0);
    expect(r.amount_incl_tax).toBe(0);
    expect(r.tax).toBe(0);
  });

  test('29900 kuruş + %20 KDV → 35880', () => {
    const r = calculateTotal(29900);
    expect(r.tax_rate).toBe(20);
    expect(r.tax).toBe(5980);
    expect(r.amount_incl_tax).toBe(35880);
  });

  test('custom tax rate', () => {
    const r = calculateTotal(10000, 10);
    expect(r.tax).toBe(1000);
    expect(r.amount_incl_tax).toBe(11000);
  });

  test('negatif tutar atar', () => {
    expect(() => calculateTotal(-1)).toThrow();
  });

  test('null tutar atar', () => {
    expect(() => calculateTotal(null)).toThrow();
  });

  test('yuvarlama: tek kuruş hassasiyetinde Math.round', () => {
    // 12345 × 20% = 2469 (Math.round)
    expect(calculateTotal(12345).tax).toBe(2469);
  });
});

describe('pricing.prorateChange', () => {
  const periodStart = '2026-05-01T00:00:00Z';
  const periodEnd = '2026-06-01T00:00:00Z'; // 31 gün

  test('dönemin başında upgrade → tam fiyat farkı', () => {
    const delta = prorateChange({
      fromPlan: 'standart', toPlan: 'pro', cycle: 'monthly',
      periodStart, periodEnd, now: periodStart,
    });
    // (159900 - 99900) × 1.0 = 60000
    expect(delta).toBe(60000);
  });

  test('dönemin sonunda upgrade → ~0', () => {
    const delta = prorateChange({
      fromPlan: 'standart', toPlan: 'pro', cycle: 'monthly',
      periodStart, periodEnd, now: periodEnd,
    });
    expect(delta).toBe(0);
  });

  test('dönemin ortasında upgrade → ~yarı fiyat farkı', () => {
    const mid = '2026-05-16T12:00:00Z'; // ~50%
    const delta = prorateChange({
      fromPlan: 'standart', toPlan: 'pro', cycle: 'monthly',
      periodStart, periodEnd, now: mid,
    });
    // 60000 × ~0.5 ≈ 30000 (±2000 tolerans, gün toleransıyla)
    expect(delta).toBeGreaterThan(28000);
    expect(delta).toBeLessThan(32000);
  });

  test('downgrade → negatif (credit)', () => {
    const delta = prorateChange({
      fromPlan: 'pro', toPlan: 'standart', cycle: 'monthly',
      periodStart, periodEnd, now: periodStart,
    });
    expect(delta).toBe(-60000);
  });

  test('baslangica geçiş → eski tutar kadar credit', () => {
    const delta = prorateChange({
      fromPlan: 'standart', toPlan: 'baslangic', cycle: 'monthly',
      periodStart, periodEnd, now: periodStart,
    });
    expect(delta).toBe(-99900);
  });

  test('geçersiz period → 0', () => {
    expect(prorateChange({
      fromPlan: 'standart', toPlan: 'pro', cycle: 'monthly',
      periodStart: '2026-06-01', periodEnd: '2026-05-01', now: '2026-05-15',
    })).toBe(0);
  });
});

describe('pricing.formatInvoiceNo', () => {
  test('2026-05-00042 formatı', () => {
    const d = new Date('2026-05-15T12:00:00Z');
    expect(formatInvoiceNo(42, d)).toBe('2026-05-00042');
  });

  test('sıralı no padding (1 → 00001)', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(formatInvoiceNo(1, d)).toBe('2026-01-00001');
  });
});

describe('pricing.isPaidPlan', () => {
  test('baslangic ücretsiz', () => {
    expect(isPaidPlan('baslangic')).toBe(false);
  });
  test('standart + pro ücretli', () => {
    expect(isPaidPlan('standart')).toBe(true);
    expect(isPaidPlan('pro')).toBe(true);
  });
  test('kurumsal null fiyat → ücretsiz değil ama ücretli de değil (false)', () => {
    expect(isPaidPlan('kurumsal')).toBe(false);
  });
});

describe('pricing sabitleri', () => {
  test('KDV oranı %20 (Türkiye 2026)', () => {
    expect(TAX_RATE).toBe(20);
  });
  test('yıllık indirim %20', () => {
    expect(YEARLY_DISCOUNT).toBe(0.20);
  });
});
