const {
  levenshteinDistance,
  similarityScore,
  snapEligible,
  charDiffs,
  substitutionBonus,
} = require('../src/services/plateMatcher');

describe('snapEligible — geçerli tam plakada uzak fuzzy snap engeli', () => {
  // Saha 2026-06-16: temiz okunmuş KAYITSIZ plaka (34CHF716) en yakın kayıtlıya
  // (34CHF451 / 34GJF916) yutuluyordu → ihlal gizleniyordu.
  test('seri no farklı + skor<85 → snap engellenir (kayıtsız kalır)', () => {
    expect(snapEligible('34CHF716', '34CHF451', 63)).toBe(false); // aynı il+harf
    expect(snapEligible('34CHF716', '34GJF916', 63)).toBe(false); // başka aday da
  });

  test('seri no BİREBİR tutuyorsa snap korunur (il/harf OCR hatası)', () => {
    expect(snapEligible('01J0552', '34VJ0552', 63)).toBe(true);
    expect(snapEligible('24HK516', '34AHH516', 63)).toBe(true);
    expect(snapEligible('04TIZ956', '34MNZ956', 63)).toBe(true);
  });

  test('skor ≥85 (tek karakter hatası) snap korunur', () => {
    expect(snapEligible('34CHF457', '34CHF451', 88)).toBe(true); // seri 1 hane
  });

  test('seri no farklı + skor<85 → engellenir (bilinen takas: garbled okuma manuel)', () => {
    expect(snapEligible('33NDU34', '34NDU233', 63)).toBe(false);
  });

  test('girdi geçerli tam plaka değilse (çöp/parça OCR) kısıt yok', () => {
    expect(snapEligible('0MG873', '34NIG873', 60)).toBe(true);
    expect(snapEligible('HT610 34', '34AHT610', 70)).toBe(true);
  });
});

describe('plateMatcher pure helpers', () => {
  test('levenshteinDistance temel', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('abc', 'abd')).toBe(1);
    expect(levenshteinDistance('abc', 'abcd')).toBe(1);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  test('similarityScore yüzde', () => {
    expect(similarityScore('34ABC123', '34ABC123')).toBe(100);
    expect(similarityScore('', 'foo')).toBe(0);
    expect(similarityScore('34ABC123', '34ABC124')).toBe(88); // 1/8 fark
  });

  test('charDiffs aynı uzunluk pozisyon başına farklar', () => {
    expect(charDiffs('34MN1089', '34MNL089')).toEqual([
      { from: '1', to: 'L', pos: 4 },
    ]);
    expect(charDiffs('34ABC123', '34ABC123')).toEqual([]);
    expect(charDiffs('AB', 'ABC')).toEqual([]); // farklı uzunluk → boş
    expect(charDiffs('', 'X')).toEqual([]);
  });

  describe('substitutionBonus', () => {
    test('boş map → 0', () => {
      expect(substitutionBonus('34A', '34B', new Map())).toBe(0);
      expect(substitutionBonus('34A', '34B', null)).toBe(0);
    });

    test('aynı plaka → 0 (diff yok)', () => {
      const map = new Map([['1>L', 100]]);
      expect(substitutionBonus('34ABC123', '34ABC123', map)).toBe(0);
    });

    test('uygun substitution bonus üretir', () => {
      const map = new Map([['1>L', 50]]);
      const bonus = substitutionBonus('34MN1089', '34MNL089', map);
      expect(bonus).toBeGreaterThan(0);
      expect(bonus).toBeLessThanOrEqual(8); // SUBSTITUTION_MAX_BONUS
    });

    test('birden fazla diff toplam ağırlık', () => {
      // Yön önemli: '1>L' = OCR "1" okudu kullanıcı "L" düzeltti.
      // Test case '341S' → '34L5' iki diff üretir: 1→L ve S→5.
      const map = new Map([
        ['1>L', 100],
        ['S>5', 100],
      ]);
      const single = substitutionBonus('34A1', '34AL', map);
      const double = substitutionBonus('341S', '34L5', map);
      // log10(101)*1.5 ≈ 3.0 single; 2 diff → ~6.0; cap 8 → ~6.0
      expect(double).toBeGreaterThan(single);
      expect(double).toBeCloseTo(2 * single, 1);
    });

    test('cap çalışıyor', () => {
      const map = new Map();
      for (const ch of 'ABCDEFGH') map.set(`${ch}>X`, 1_000_000);
      const bonus = substitutionBonus('ABCDEFGH', 'XXXXXXXX', map);
      expect(bonus).toBe(8); // SUBSTITUTION_MAX_BONUS
    });

    test('düşük count → düşük bonus', () => {
      const low = new Map([['1>L', 1]]);
      const high = new Map([['1>L', 100]]);
      const bLow = substitutionBonus('34A1', '34AL', low);
      const bHigh = substitutionBonus('34A1', '34AL', high);
      expect(bHigh).toBeGreaterThan(bLow);
    });
  });
});

const DB_AVAILABLE = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('plateMatcher DB integration', () => {
  const db = require('../src/db');
  const {
    recordLearning,
    recordSubstitutions,
    getSubstitutionMap,
    clearSubstitutionCache,
    findBestMatch,
  } = require('../src/services/plateMatcher');
  const { createTestDaire, createTestArac } = require('./helpers');

  beforeEach(async () => {
    clearSubstitutionCache();
    await db('plate_char_substitutions').del();
    await db('plate_learnings').del();
    await db('araclar').del();
    await db('daireler').del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('recordLearning hem learnings hem substitutions yazar', async () => {
    // recordLearning artık yalnız KAYITLI plakaları öğrenir (havuz zehirlenme
    // önlemi, commit 9d8a06b) — hedef plakayı önce kayıtlı yap.
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34MNL089' });

    await recordLearning('34MN1089', '34MNL089', 1);

    const learn = await db('plate_learnings').where({ ocr_raw: '34MN1089' }).first();
    expect(learn.correct_plaka).toBe('34MNL089');

    const sub = await db('plate_char_substitutions')
      .where({ from_char: '1', to_char: 'L' })
      .first();
    expect(sub).toBeTruthy();
    expect(sub.count).toBe(1);
  });

  test('recordLearning kayıtsız correct_plaka\'yı öğrenmez (zehir önleme)', async () => {
    // Hiçbir araç kayıtlı değil → 36VK6148 kayıtsız. PR/OCR yanlış-okuması
    // havuza "doğru" diye girmemeli (sonraki okumaları kayıtsıza snap'leyip
    // gerçek kayıtlıyı gölgelerdi).
    await recordLearning('36VK0187', '36VK6148', 1);
    const learn = await db('plate_learnings').where({ ocr_raw: '36VK0187' }).first();
    expect(learn).toBeUndefined();
    // Substitution histogramına da yazılmamalı.
    const subs = await db('plate_char_substitutions').select('*');
    expect(subs).toHaveLength(0);
  });

  test('recordLearning kayıtlı-hedefli zehri öğrenmez (snapEligible gate)', async () => {
    // İki kayıtlı plaka: A9'un aracı 34CHF451, başka aracın 34CHF716.
    // OCR 34CHF716'yı DOĞRU okudu ama kullanıcı yanlışlıkla 34CHF451 onayladı.
    // Seri no farklı (716≠451) + skor<85 → matcher snap etmez → öğrenilmemeli.
    const a9 = await createTestDaire({ daire_no: 'A9' });
    await createTestArac({ daire_id: a9.id, plaka: '34CHF451' });
    await recordLearning('34CHF716', '34CHF451', 1);
    const learn = await db('plate_learnings').where({ ocr_raw: '34CHF716' }).first();
    expect(learn).toBeUndefined();
  });

  test('recordLearning meşru yakın düzeltmeyi öğrenir (seri birebir / skor≥85)', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34VJ0552' });
    // OCR ilini/harfini yanlış okudu ama seri no (0552) birebir → öğrenilmeli.
    await recordLearning('01J0552', '34VJ0552', 1);
    const learn = await db('plate_learnings').where({ ocr_raw: '01J0552' }).first();
    expect(learn?.correct_plaka).toBe('34VJ0552');
  });

  test('aynı substitution tekrarı count++', async () => {
    await recordSubstitutions('34A1', '34AL', 1);
    await recordSubstitutions('34X1Y', '34XLY', 1);
    const sub = await db('plate_char_substitutions')
      .where({ from_char: '1', to_char: 'L' })
      .first();
    expect(sub.count).toBe(2);
  });

  test('farklı uzunluk → substitution yazılmaz', async () => {
    await recordSubstitutions('34AB', '34ABC', 1);
    const subs = await db('plate_char_substitutions').select('*');
    expect(subs).toHaveLength(0);
  });

  test('findBestMatch substitution bonus ile zayıf fuzzy match\'i öne çıkarır', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34MNL089' });
    await createTestArac({ daire_id: daire.id, plaka: '34MNT089' });

    // Histograma 1↔L pattern'ini güçlü yaz
    for (let i = 0; i < 10; i++) {
      await recordSubstitutions('34A1', '34AL', 1);
    }
    clearSubstitutionCache();

    // OCR "34MN1089" okudu — hem L hem T tek karakter farklı
    // Histogram olmadan iki seçenek tie; histogramla L kazanmalı
    const match = await findBestMatch('34MN1089', 1);
    expect(match).toBeTruthy();
    expect(match.plaka).toBe('34MNL089');
    expect(match.substitutionBonus).toBeGreaterThan(0);
  });
});
