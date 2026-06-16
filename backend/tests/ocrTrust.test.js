const {
  isMatchTrustedForPRSkip,
  FUZZY_TRUST_SCORE,
  CACHE_TRUST_THRESHOLD,
} = require('../src/services/ocrTrust');

describe('isMatchTrustedForPRSkip — PR fallback atlama karari', () => {
  test('eslesme yoksa guvenilmez', () => {
    expect(isMatchTrustedForPRSkip(null)).toBe(false);
    expect(isMatchTrustedForPRSkip({ corrected: null, score: 100 })).toBe(false);
  });

  test('skor >= 95 her kaynaktan guvenilir (learned-exact/signature)', () => {
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 100, source: 'learned-exact' })).toBe(true);
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 95, source: 'learned-signature' })).toBe(true);
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 96, source: 'fuzzy-learned' })).toBe(true);
  });

  test('fuzzy-registered / raw-registered: skor >= 80 guvenilir (saha kalibre)', () => {
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 80, source: 'fuzzy-registered' })).toBe(true);
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 88, source: 'raw-registered' })).toBe(true);
  });

  test('fuzzy-registered skor < 80 → PR (guvenilmez)', () => {
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 79, source: 'fuzzy-registered' })).toBe(false);
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 63, source: 'fuzzy-registered' })).toBe(false);
  });

  test('fuzzy-learned HARIC: 80-94 arasi guvenilmez (PR)', () => {
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 90, source: 'fuzzy-learned' })).toBe(false);
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 85, source: 'fuzzy-learned' })).toBe(false);
  });

  test('plate-recognizer kaynagi 80-94 arasi guvenilmez (REGISTERED_TRUST disinda)', () => {
    expect(isMatchTrustedForPRSkip({ corrected: '34ABC123', score: 85, source: 'plate-recognizer' })).toBe(false);
  });

  test('esik sabitleri beklenen degerlerde', () => {
    expect(FUZZY_TRUST_SCORE).toBe(80);
    expect(CACHE_TRUST_THRESHOLD).toBe(95);
  });
});
