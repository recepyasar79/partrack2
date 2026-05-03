const { detectViolations } = require('../src/utils/violations');

describe('detectViolations — idempotency davranışı', () => {
  const daire = {
    daire_id: 1,
    daire_no: 'B5',
    sahip_ad: 'Ali',
    sahip_tel: '05551234567',
    bildirim_opt_in: true,
  };

  test('aynı plakalar tekrar verildiğinde aynı sonuç gelir (deduplication)', () => {
    const map = new Map([
      ['34ABC123', daire],
      ['34DEF456', daire],
    ]);
    const r1 = detectViolations({ plakalar: ['34ABC123', '34DEF456'], plakaToDaire: map });
    const r2 = detectViolations({ plakalar: ['34abc123', ' 34 DEF 456 ', '34ABC123'], plakaToDaire: map });
    expect(r2.ihlalYapanDaireler).toHaveLength(1);
    expect(new Set(r1.ihlalYapanDaireler[0].plakalar)).toEqual(
      new Set(r2.ihlalYapanDaireler[0].plakalar)
    );
  });

  test('opt-in bilgisi ihlal sonucunda korunur (downstream filtreleme için)', () => {
    const noOptIn = { ...daire, daire_id: 2, daire_no: 'C10', bildirim_opt_in: false };
    const map = new Map([
      ['34A', daire],
      ['34B', daire],
      ['06C', noOptIn],
      ['06D', noOptIn],
    ]);
    const r = detectViolations({
      plakalar: ['34A', '34B', '06C', '06D'],
      plakaToDaire: map,
    });
    expect(r.ihlalYapanDaireler).toHaveLength(2);
    const optIns = r.ihlalYapanDaireler.map((i) => i.bildirim_opt_in).sort();
    expect(optIns).toEqual([false, true]);
  });
});
