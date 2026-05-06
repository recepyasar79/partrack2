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

  test('3 harfli plakada 4 rakam Türk plaka kuralına aykırı, alt satır rakamı yutulmaz', () => {
    // 3 harf + 4 rakam Türk plakası YOK. "34BHP1985" tek satırda gelse bile
    // "34BHP198" doğru ayrıştırma; "5" plakaya katılmamalı.
    const r = extractPlate('34BHP1985');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34BHP198');
  });

  test('1 harfli plaka 4 rakam alabilir', () => {
    const r = extractPlate('34A1234');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34A1234');
  });

  test('2 harfli plaka 4 rakam alabilir', () => {
    const r = extractPlate('34AB1234');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34AB1234');
  });

  test('son rakam ayrı satıra düşerse (2 harf) plakaya eklenir', () => {
    const r = extractPlate('34YF987\n6');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34YF9876');
  });

  test('son rakam gürültülü satırlar arasında kaybolursa (2 harf) yine eklenir', () => {
    const r = extractPlate('NCROAAY\n34YF987\nXY\n7\nRC');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34YF9877');
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

  test('symbol-level bbox: tek word içinde alt satıra düşen karakter ayrılır', () => {
    // Tesseract '34KRC458' tek kelime olarak rapor edebiliyor; ama symbol
    // bbox'larından son '8' alt satırda (yüksek y). Karakterleri y'ye göre
    // grupla → '34KRC45' üst satır, '8' alt satır → plaka '34KRC45'.
    const symbol = (text, y0, y1, x0, x1) => ({ text, bbox: { x0, y0, x1, y1 } });
    const word = {
      text: '34KRC458',
      bbox: { x0: 0, y0: 100, x1: 320, y1: 230 },
      symbols: [
        symbol('3', 100, 130, 0, 30),
        symbol('4', 100, 130, 35, 65),
        symbol('K', 100, 130, 80, 120),
        symbol('R', 100, 130, 125, 165),
        symbol('C', 100, 130, 170, 210),
        symbol('4', 100, 130, 220, 250),
        symbol('5', 100, 130, 255, 285),
        symbol('8', 200, 230, 290, 320), // alt satır
      ],
    };
    const r = extractPlate('34KRC458', [word]);
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('34KRC45');
  });

  test('iki ayrı plaka aday: aynı satırda extraChars=0 olan kazanır', () => {
    // İlk satırda fazlalık var, ikincide tam eşleşme.
    const r = extractPlate('XXX34ABC123\n06DEF45');
    expect(r.matched).toBe(true);
    expect(r.guess).toBe('06DEF45');
  });
});
