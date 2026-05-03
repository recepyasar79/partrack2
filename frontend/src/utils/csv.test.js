import { describe, test, expect } from 'vitest';
import { toCSV } from './csv';

describe('toCSV', () => {
  test('UTF-8 BOM + ; separator + Türkçe karakter korunur', () => {
    const rows = [{ ad: 'Ali Şahin', plaka: '34ABC123' }];
    const csv = toCSV(rows, [
      { key: 'ad', label: 'Ad' },
      { key: 'plaka', label: 'Plaka' },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Ad;Plaka');
    expect(csv).toContain('Ali Şahin;34ABC123');
  });

  test('virgül/tırnak içeren değerler quote edilir', () => {
    const rows = [{ a: 'foo;bar', b: 'has "quote"' }];
    const csv = toCSV(rows, [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]);
    expect(csv).toContain('"foo;bar"');
    expect(csv).toContain('"has ""quote"""');
  });
});
