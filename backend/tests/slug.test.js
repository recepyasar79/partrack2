const { generateSiteSlug, ALPHABET } = require('../src/utils/slug');

describe('generateSiteSlug', () => {
  test('10 karakter üretir', () => {
    expect(generateSiteSlug()).toHaveLength(10);
  });

  test('sadece güvenli alfabe karakterleri (l/1/I/O/0 yok)', () => {
    for (let i = 0; i < 50; i++) {
      const s = generateSiteSlug();
      for (const c of s) {
        expect(ALPHABET).toContain(c);
      }
      // Yasak karakterler
      expect(s).not.toMatch(/[lIO01]/);
    }
  });

  test('100 üretimde tekrar yok (çarpışma olasılığı ihmal edilebilir)', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateSiteSlug());
    expect(set.size).toBe(100);
  });
});
