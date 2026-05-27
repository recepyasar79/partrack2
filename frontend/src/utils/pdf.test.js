import { describe, test, expect } from 'vitest';
import { tr2ascii } from './pdf';

describe('tr2ascii', () => {
  test('Türkçe karakterleri ASCII karşılığına çevirir', () => {
    expect(tr2ascii('Çoklu Araç İhlali')).toBe('Coklu Arac Ihlali');
    expect(tr2ascii('şahsi şuur ÇIĞ')).toBe('sahsi suur CIG');
    expect(tr2ascii('Üst Öğretim İçin')).toBe('Ust Ogretim Icin');
  });

  test('null/undefined/sayı → güvenli', () => {
    expect(tr2ascii(null)).toBe('');
    expect(tr2ascii(undefined)).toBe('');
    expect(tr2ascii(42)).toBe('42');
  });

  test('ASCII-only input olduğu gibi döner', () => {
    expect(tr2ascii('Hello World 34ABC123')).toBe('Hello World 34ABC123');
  });
});
