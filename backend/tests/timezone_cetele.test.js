const { ceteleGunuTR, CETELE_RESET_SAATI, dayjs, TR_TZ } = require('../src/utils/timezone');

// Çetele operasyon günü 08:00 TR'de döner: 00:00-07:59 arası bir ÖNCEKI güne
// sayılır, 08:00'den itibaren takvim günü.
describe('ceteleGunuTR — 08:00 reset', () => {
  const trAt = (iso) => dayjs.tz(iso, TR_TZ);

  test('reset saati 08:00', () => {
    expect(CETELE_RESET_SAATI).toBe(8);
  });

  test('gece yarısı (00:30) → önceki gün', () => {
    expect(ceteleGunuTR(trAt('2026-06-18 00:30'))).toBe('2026-06-17');
  });

  test('07:59 → hâlâ önceki gün', () => {
    expect(ceteleGunuTR(trAt('2026-06-18 07:59'))).toBe('2026-06-17');
  });

  test('08:00 tam → yeni gün (sıfırlama)', () => {
    expect(ceteleGunuTR(trAt('2026-06-18 08:00'))).toBe('2026-06-18');
  });

  test('akşam kontrolü saati (20:00) → aynı gün', () => {
    expect(ceteleGunuTR(trAt('2026-06-17 20:00'))).toBe('2026-06-17');
  });
});
