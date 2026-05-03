const {
  isValidDaireNo,
  isValidPlaka,
  isValidTelefon,
  normalizePlaka,
  parseDaireNo,
} = require('../src/utils/validators');

describe('isValidDaireNo', () => {
  test.each(['A1', 'B34', 'D17', 'C29', 'A9', 'A10'])('kabul: %s', (no) => {
    expect(isValidDaireNo(no)).toBe(true);
  });

  test.each(['E1', 'A0', 'A35', 'a1', 'A 1', '', null, undefined, 'AA1', 'A100', 'A-1'])(
    'red: %s',
    (no) => {
      expect(isValidDaireNo(no)).toBe(false);
    }
  );
});

describe('isValidPlaka', () => {
  test.each(['34ABC123', '06AB1234', '07X12', '34A1234', 'CC1234', 'CD12345', 'G12345'])(
    'kabul: %s',
    (p) => {
      expect(isValidPlaka(p)).toBe(true);
    }
  );

  test.each(['ABC1234', '34-ABC-123', '', null, '34A1', '1234'])('red: %s', (p) => {
    expect(isValidPlaka(p)).toBe(false);
  });

  test('lowercase + boşluk normalize edilir', () => {
    expect(isValidPlaka('34abc123')).toBe(true);
    expect(isValidPlaka(' 34 abc 123 ')).toBe(true);
  });
});

describe('normalizePlaka', () => {
  test('boşlukları kaldırır ve uppercase yapar', () => {
    expect(normalizePlaka(' 34 abc 123 ')).toBe('34ABC123');
    expect(normalizePlaka('06aB1234')).toBe('06AB1234');
  });
  test('string olmayanı boş döner', () => {
    expect(normalizePlaka(null)).toBe('');
    expect(normalizePlaka(undefined)).toBe('');
    expect(normalizePlaka(123)).toBe('');
  });
});

describe('isValidTelefon', () => {
  test('05 ile başlayıp 11 hane kabul', () => {
    expect(isValidTelefon('05551234567')).toBe(true);
  });
  test.each(['5551234567', '905551234567', '+905551234567', '05551', ''])('red: %s', (t) => {
    expect(isValidTelefon(t)).toBe(false);
  });
});

describe('parseDaireNo', () => {
  test('B5 → blok B, sira 5', () => {
    expect(parseDaireNo('B5')).toEqual({ blok: 'B', sira_no: 5 });
  });
  test('A34 → blok A, sira 34', () => {
    expect(parseDaireNo('A34')).toEqual({ blok: 'A', sira_no: 34 });
  });
  test('geçersiz → null', () => {
    expect(parseDaireNo('A35')).toBeNull();
    expect(parseDaireNo('E1')).toBeNull();
  });
});
