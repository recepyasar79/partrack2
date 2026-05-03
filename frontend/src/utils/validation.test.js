import { describe, test, expect } from 'vitest';
import {
  isValidDaireNo,
  isValidPlaka,
  isValidTelefon,
  normalizePlaka,
  formatTelefon,
  unformatTelefon,
} from './validation';

describe('validation', () => {
  test('daire no kabul/red', () => {
    expect(isValidDaireNo('A1')).toBe(true);
    expect(isValidDaireNo('D34')).toBe(true);
    expect(isValidDaireNo('E1')).toBe(false);
    expect(isValidDaireNo('A35')).toBe(false);
  });

  test('plaka normalize + valid', () => {
    expect(normalizePlaka(' 34 abc 123 ')).toBe('34ABC123');
    expect(isValidPlaka('34abc123')).toBe(true);
    expect(isValidPlaka('ABC123')).toBe(false);
  });

  test('telefon format/unformat round-trip', () => {
    expect(isValidTelefon('05551234567')).toBe(true);
    expect(formatTelefon('05551234567')).toBe('0555 123 45 67');
    expect(unformatTelefon('0555 123 45 67')).toBe('05551234567');
  });

  test('telefon kısa girdi formatlama', () => {
    expect(formatTelefon('0555')).toBe('0555');
    expect(formatTelefon('0555123')).toBe('0555 123');
    expect(formatTelefon('055512345')).toBe('0555 123 45');
  });
});
