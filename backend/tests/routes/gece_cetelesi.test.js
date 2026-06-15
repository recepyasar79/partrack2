const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');
const { todayTR } = require('../../src/utils/timezone');

let guvToken, guv;

beforeAll(async () => {
  guv = await createTestUser({ kullanici_adi: 'gcguv', rol: 'guvenlik' });
  guvToken = makeToken({ id: guv.id, kullanici_adi: 'gcguv', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([guv]); // daireler CASCADE → gece_cetelesi temizlenir
});

async function gorulen(plaka) {
  await db('gunluk_kontroller').insert({ kontrol_tarihi: todayTR(), plaka, site_id: 1 });
}

const auth = (r) => r.set('Authorization', `Bearer ${guvToken}`);

describe('Gece Çetelesi', () => {
  test('GET akşam tespitinden daire başına sayıyı tohumlar', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    const a2 = await createTestDaire({ daire_no: 'A2' });
    const a3 = await createTestDaire({ daire_no: 'A3' });
    await createTestArac({ daire_id: a1.id, plaka: '34AA001' });
    await createTestArac({ daire_id: a1.id, plaka: '34AA002' });
    await createTestArac({ daire_id: a2.id, plaka: '34AA003' });
    await createTestArac({ daire_id: a3.id, plaka: '34AA004' });
    await gorulen('34AA001');
    await gorulen('34AA002');
    await gorulen('34AA003'); // a3'ün aracı görülmedi → 0

    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.status).toBe(200);
    const byNo = Object.fromEntries(res.body.daireler.map((d) => [d.daire_no, d.arac_sayisi]));
    expect(byNo.A1).toBe(2);
    expect(byNo.A2).toBe(1);
    expect(byNo.A3).toBe(0);
  });

  test('tohum yalnız bir kez — ikinci GET aynı değerleri döner (yeniden hesaplamaz)', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34BB001' });
    await gorulen('34BB001');
    await auth(request(app).get('/api/kontroller/gece-cetelesi')); // tohumla (1)
    await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a1.id}`).send({ delta: 1 })); // 2 yap
    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const a1row = res.body.daireler.find((d) => d.daire_no === 'A1');
    expect(a1row.arac_sayisi).toBe(2); // re-seed olsaydı 1'e dönerdi
  });

  test('PATCH +1/-1 çalışır ve 0 altına inmez', async () => {
    const a5 = await createTestDaire({ daire_no: 'A5' });
    await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    let r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a5.id}`).send({ delta: 1 }));
    expect(r.status).toBe(200);
    expect(r.body.arac_sayisi).toBe(1);
    r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a5.id}`).send({ delta: 1 }));
    expect(r.body.arac_sayisi).toBe(2);
    r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a5.id}`).send({ delta: -1 }));
    expect(r.body.arac_sayisi).toBe(1);
    await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a5.id}`).send({ delta: -1 }));
    r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a5.id}`).send({ delta: -1 }));
    expect(r.body.arac_sayisi).toBe(0); // clamp
  });

  test('tohumlanmamış daire PATCH ile upsert edilir', async () => {
    const a7 = await createTestDaire({ daire_no: 'A7' });
    const r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a7.id}`).send({ delta: 1 }));
    expect(r.status).toBe(200);
    expect(r.body.arac_sayisi).toBe(1);
  });

  test('geçersiz delta 400', async () => {
    const a6 = await createTestDaire({ daire_no: 'A6' });
    const r = await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a6.id}`).send({ delta: 5 }));
    expect(r.status).toBe(400);
  });

  test('olmayan daire 404', async () => {
    const r = await auth(request(app).patch('/api/kontroller/gece-cetelesi/999999').send({ delta: 1 }));
    expect(r.status).toBe(404);
  });

  test('araya giren stray satır diğer dairelerin tohumunu engellemez', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    const a2 = await createTestDaire({ daire_no: 'A2' });
    await createTestArac({ daire_id: a1.id, plaka: '34CC001' });
    await createTestArac({ daire_id: a2.id, plaka: '34CC002' });
    await gorulen('34CC001');
    await gorulen('34CC002');
    // Launch testi gibi araya stray satır (a1, 0). Eski "satır varsa atla"
    // kodunda bu TÜM tohumu engelliyordu (saha bug'ı: hepsi gri kalıyordu).
    await db('gece_cetelesi').insert({ site_id: 1, daire_id: a1.id, tarih: todayTR(), arac_sayisi: 0 });

    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const byNo = Object.fromEntries(res.body.daireler.map((d) => [d.daire_no, d.arac_sayisi]));
    expect(byNo.A2).toBe(1); // stray, A2'nin tohumlanmasını engellemez (asıl fix)
    expect(byNo.A1).toBe(0); // mevcut/manuel satıra dokunulmaz
    // yenile=1 stray'i akşam tespitine düzeltir
    const res2 = await auth(request(app).get('/api/kontroller/gece-cetelesi?yenile=1'));
    const byNo2 = Object.fromEntries(res2.body.daireler.map((d) => [d.daire_no, d.arac_sayisi]));
    expect(byNo2.A1).toBe(1);
  });

  test('seed sonrası daire eklenince manuel sayımlar korunur (veri kaybı yok)', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34EE001' });
    await gorulen('34EE001');
    await auth(request(app).get('/api/kontroller/gece-cetelesi')); // tohum A1=1
    await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a1.id}`).send({ delta: 1 })); // A1=2 (manuel)
    // Gece yarısı yeni daire eklendi — eski kodda bu re-seed tetikleyip A1'i
    // 1'e sıfırlıyordu (kod incelemesi bulgusu).
    const a2 = await createTestDaire({ daire_no: 'A2' });
    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const byNo = Object.fromEntries(res.body.daireler.map((d) => [d.daire_no, d.arac_sayisi]));
    expect(byNo.A1).toBe(2); // manuel sayım KORUNDU
    expect(byNo.A2).toBe(0); // yeni daire eklendi (akşam tespiti 0)
  });

  test('?yenile=1 manuel sayımları akşam tespitine sıfırlar', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34DD001' });
    await gorulen('34DD001');
    await auth(request(app).get('/api/kontroller/gece-cetelesi')); // tohum A1=1
    await auth(request(app).patch(`/api/kontroller/gece-cetelesi/${a1.id}`).send({ delta: 1 })); // A1=2
    let res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(2); // manuel korunur
    res = await auth(request(app).get('/api/kontroller/gece-cetelesi?yenile=1'));
    expect(res.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(1); // tespite döndü
  });

  test('token olmadan 401', async () => {
    const r = await request(app).get('/api/kontroller/gece-cetelesi');
    expect(r.status).toBe(401);
  });
});
