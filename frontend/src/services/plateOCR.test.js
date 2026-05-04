import { describe, test, expect } from 'vitest';
import { extractPlate } from './plateOCR';

function w(text, y0, y1, x0 = 0, x1 = 100) {
  return { text, bbox: { x0, y0, x1, y1 } };
}

describe('extractPlate', () => {
  test('boş giriş', () => {
    expect(extractPlate('')).toEqual({ guess: '', matched: false });
    expect(extractPlate(null)).toEqual({ guess: '', matched: false });
  });

  test('tek satırda standart plaka', () => {
    const r = extractPlate('34BHP198');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('satırlar arasında alt satırdaki rakam plakaya eklenmemeli', () => {
    // Plaka ilk satır, "5" ise alt satır — plakanın parçası değil.
    const r = extractPlate('34BHP198\n5');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('PSM 11 sparse: parçalı satırlar birleştirilse bile fazla satır eklenmez', () => {
    // Tesseract sparse modunda her bileşeni ayrı satıra koyabilir.
    // En az satır birleştiren tam eşleşme tercih edilmeli.
    const r = extractPlate('34\nBHP\n198\n5');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('bbox bilgisi varsa visual row text-line yorumlamasını ezer', () => {
    // Tesseract metni "34BHP1985" tek satır gibi gösterse bile, bbox ile
    // "5"in alt satırda olduğu görülürse plakaya katılmamalı.
    const words = [
      w('34', 100, 130),
      w('BHP', 100, 130, 110, 200),
      w('198', 100, 130, 210, 300),
      w('5', 200, 230, 0, 30), // alt satır
    ];
    const r = extractPlate('34BHP1985', words);
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('bbox bilgisi yoksa tek satır metin tek plaka olarak yorumlanır', () => {
    // Bbox yokken "34BHP1985" tek satırdaysa ayıramayız — greedy matchwins.
    const r = extractPlate('34BHP1985');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP1985');
  });

  test('aynı satırda fazla karakter varsa tam eşleşmeli aday tercih edilir', () => {
    // "X34BHP198Y" değil; ama "34BHP198 GARBAGE" olabilir
    const r = extractPlate('34BHP198\n34BHP198XX');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('diplomatik plaka', () => {
    const r = extractPlate('CC12345');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('CC12345');
  });

  test('geçersiz şehir kodu reddedilir', () => {
    // 99 geçerli değil (TR şehir kodları 01-81)
    const r = extractPlate('99ABC123');
    expect(r.matched).toBe(false);
  });

  test('iki ayrı plaka aday: aynı satırda extraChars=0 olan kazanır', () => {
    // İlk satırda fazlalık var, ikincide tam eşleşme.
    const r = extractPlate('XXX34ABC123\n06DEF45');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('06DEF45');
  });
});
