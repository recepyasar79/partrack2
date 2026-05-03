const { detectViolations } = require('../src/utils/violations');

function buildMap(entries) {
  const m = new Map();
  for (const [plaka, daire] of entries) m.set(plaka, daire);
  return m;
}

describe('detectViolations', () => {
  const daireA1 = { daire_id: 1, daire_no: 'A1', sahip_ad: 'Ali', sahip_tel: '05551110001', bildirim_opt_in: true };
  const daireB5 = { daire_id: 2, daire_no: 'B5', sahip_ad: 'Ayşe', sahip_tel: '05551110002', bildirim_opt_in: true };

  test('1 daireye 1 plaka → ihlal yok', () => {
    const map = buildMap([['34ABC123', daireA1]]);
    const r = detectViolations({ plakalar: ['34ABC123'], plakaToDaire: map });
    expect(r.ihlalYapanDaireler).toEqual([]);
    expect(r.kayitsizPlakalar).toEqual([]);
  });

  test('1 daireye 2 plaka → ihlal var', () => {
    const map = buildMap([
      ['34ABC123', daireB5],
      ['34DEF456', daireB5],
    ]);
    const r = detectViolations({
      plakalar: ['34ABC123', '34DEF456'],
      plakaToDaire: map,
    });
    expect(r.ihlalYapanDaireler).toHaveLength(1);
    expect(r.ihlalYapanDaireler[0].daire_no).toBe('B5');
    expect(r.ihlalYapanDaireler[0].plakalar.sort()).toEqual(['34ABC123', '34DEF456']);
  });

  test('aynı plaka 2 kez → tek say', () => {
    const map = buildMap([['34ABC123', daireA1]]);
    const r = detectViolations({
      plakalar: ['34ABC123', '34abc123', ' 34 ABC 123 '],
      plakaToDaire: map,
    });
    expect(r.ihlalYapanDaireler).toEqual([]);
  });

  test('kayıtsız plaka → kayitsizPlakalar', () => {
    const r = detectViolations({
      plakalar: ['99XYZ999'],
      plakaToDaire: new Map(),
    });
    expect(r.kayitsizPlakalar).toEqual(['99XYZ999']);
  });

  test('boş input → ihlal yok', () => {
    const r = detectViolations({ plakalar: [], plakaToDaire: new Map() });
    expect(r.ihlalYapanDaireler).toEqual([]);
    expect(r.kayitsizPlakalar).toEqual([]);
  });

  test('misafir plaka sayım dışı', () => {
    const map = buildMap([
      ['34ABC123', daireB5],
      ['34DEF456', daireB5],
    ]);
    const r = detectViolations({
      plakalar: ['34ABC123', '34DEF456'],
      plakaToDaire: map,
      misafirPlakalar: new Set(['34DEF456']),
    });
    expect(r.ihlalYapanDaireler).toEqual([]);
  });
});
