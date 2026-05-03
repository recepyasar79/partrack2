const { detectViolations } = require('../src/utils/violations');

function buildMap(entries) {
  const m = new Map();
  for (const [plaka, daire] of entries) m.set(plaka, daire);
  return m;
}

describe('detectViolations guest vehicles', () => {
  const daireB5 = {
    daire_id: 2,
    daire_no: 'B5',
    sahip_ad: 'Ayse',
    sahip_tel: '05551110002',
    bildirim_opt_in: true,
  };

  test('active guest plate is counted and annotated', () => {
    const r = detectViolations({
      plakalar: ['34ABC123', '34DEF456'],
      plakaToDaire: buildMap([['34ABC123', daireB5]]),
      misafirPlakaToDaire: buildMap([['34DEF456', daireB5]]),
    });

    expect(r.ihlalYapanDaireler).toHaveLength(1);
    expect(r.ihlalYapanDaireler[0].plakalar.sort()).toEqual(['34ABC123', '34DEF456']);
    expect(r.ihlalYapanDaireler[0].misafir_plakalar).toEqual(['34DEF456']);
    expect(r.kayitsizPlakalar).toEqual([]);
  });

  test('single active guest plate is not reported as unregistered', () => {
    const r = detectViolations({
      plakalar: ['34DEF456'],
      plakaToDaire: new Map(),
      misafirPlakaToDaire: buildMap([['34DEF456', daireB5]]),
    });

    expect(r.ihlalYapanDaireler).toEqual([]);
    expect(r.kayitsizPlakalar).toEqual([]);
  });
});
