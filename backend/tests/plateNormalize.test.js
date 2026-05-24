const { normalizeSignature } = require('../src/utils/plateNormalize');

describe('normalizeSignature', () => {
  test('boş/null girdi → boş string', () => {
    expect(normalizeSignature('')).toBe('');
    expect(normalizeSignature(null)).toBe('');
    expect(normalizeSignature(undefined)).toBe('');
  });

  test('uppercase ve non-alnum strip', () => {
    expect(normalizeSignature('34 abc 123')).toBe('34A8C123');
    expect(normalizeSignature('34-XYZ-99')).toBe('34XY299');
  });

  test('confusion class: O/Q/0 → 0', () => {
    expect(normalizeSignature('OQ0')).toBe('000');
  });

  test('confusion class: I/L/1 → 1', () => {
    expect(normalizeSignature('IL1')).toBe('111');
  });

  test('confusion class: T/7 → 7', () => {
    expect(normalizeSignature('T7')).toBe('77');
  });

  test('confusion class: B/8 → 8', () => {
    expect(normalizeSignature('B8')).toBe('88');
  });

  test('confusion class: S/5 → 5, Z/2 → 2', () => {
    expect(normalizeSignature('S5Z2')).toBe('5522');
  });

  test('D 0 sınıfına girmez (yaygın plaka harfi)', () => {
    expect(normalizeSignature('25ADT773')).toBe('25AD7773');
    expect(normalizeSignature('D')).toBe('D');
  });

  test('saha vakaları: 25ADT773 ↔ 25AD7773 aynı signature', () => {
    expect(normalizeSignature('25ADT773')).toBe(normalizeSignature('25AD7773'));
  });

  test('saha vakası: 34RL5593 ↔ 14RI5593 L↔I tutar, 3↔1 tutmaz', () => {
    // L→1 ve I→1, ama 3 ve 1 farklı sınıfta → signature'lar farklı kalır
    expect(normalizeSignature('34RL5593')).toBe('34R15593');
    expect(normalizeSignature('14RI5593')).toBe('14R15593');
    expect(normalizeSignature('34RL5593')).not.toBe(normalizeSignature('14RI5593'));
  });

  test('saha vakası: 78ABU405 ↔ 48U4057 farklı uzunluk/sıra — signature farklı', () => {
    expect(normalizeSignature('78ABU405')).not.toBe(normalizeSignature('48U4057'));
  });

  test('idempotent: signature(signature(x)) === signature(x)', () => {
    const s = normalizeSignature('25ADT773');
    expect(normalizeSignature(s)).toBe(s);
  });
});
