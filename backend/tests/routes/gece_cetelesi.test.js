const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');
const { ceteleGunuTR } = require('../../src/utils/timezone');

let guvToken, guv;

beforeAll(async () => {
  guv = await createTestUser({ kullanici_adi: 'gcguv', rol: 'guvenlik' });
  guvToken = makeToken({ id: guv.id, kullanici_adi: 'gcguv', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([guv]); // daireler CASCADE → gece_cetelesi temizlenir
});

async function gorulen(plaka) {
  // Çetele operasyon günüyle (08:00 reset) eşleş — endpoint bu tarihten okur.
  await db('gunluk_kontroller').insert({ kontrol_tarihi: ceteleGunuTR(), plaka, site_id: 1 });
}

const auth = (r) => r.set('Authorization', `Bearer ${guvToken}`);

describe('Gece Çetelesi (türev — gunluk_kontroller canlı)', () => {
  test('GET daire başına araç sayısını yüklemelerden hesaplar', async () => {
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

  test('GET her daire için içerideki plakaları döner', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    const a2 = await createTestDaire({ daire_no: 'A2' });
    await createTestArac({ daire_id: a1.id, plaka: '34AA001' });
    await createTestArac({ daire_id: a1.id, plaka: '34AA002' });
    await gorulen('34AA001');
    await gorulen('34AA002');

    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const a1row = res.body.daireler.find((d) => d.daire_no === 'A1');
    const a2row = res.body.daireler.find((d) => d.daire_no === 'A2');
    expect([...a1row.plakalar].sort()).toEqual(['34AA001', '34AA002']);
    expect(a2row.plakalar).toEqual([]); // boş daire → boş liste
    expect(a2row.arac_sayisi).toBe(0);
  });

  test('elle plaka ekleme çeteleye otomatik yansır (giriş)', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34BB001' });

    let res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(0);

    await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34BB001' });

    res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const a1row = res.body.daireler.find((d) => d.daire_no === 'A1');
    expect(a1row.arac_sayisi).toBe(1);
    expect(a1row.plakalar).toEqual(['34BB001']);
  });

  test('yükleme silme çeteleye otomatik yansır (çıkış)', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34CC001' });
    const add = await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34CC001' });
    const kid = add.body.kontrol.id;

    let res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(1);

    await auth(request(app).delete(`/api/kontroller/${kid}`));

    res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(0);
  });

  test('misafir plaka ilgili dairenin sayımına dahil edilir', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    const gunBasi = `${ceteleGunuTR()} 00:00:00`;
    const gunSonu = `${ceteleGunuTR()} 23:59:59`;
    await db('misafir_araclar').insert({
      site_id: 1, daire_id: a1.id, plaka: '34MIS001',
      baslangic_tarihi: gunBasi, bitis_tarihi: gunSonu,
    });
    await gorulen('34MIS001');

    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const a1row = res.body.daireler.find((d) => d.daire_no === 'A1');
    expect(a1row.arac_sayisi).toBe(1);
    expect(a1row.plakalar).toEqual(['34MIS001']);
  });

  test('GET ikinci_arac_izinli bayrağını döner', async () => {
    await createTestDaire({ daire_no: 'C1', ikinci_arac_izinli: true });
    await createTestDaire({ daire_no: 'C2' });
    const res = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    const byNo = Object.fromEntries(res.body.daireler.map((d) => [d.daire_no, d.ikinci_arac_izinli]));
    expect(byNo.C1).toBe(true);
    expect(byNo.C2).toBe(false);
  });

  test('token olmadan 401', async () => {
    const r = await request(app).get('/api/kontroller/gece-cetelesi');
    expect(r.status).toBe(401);
  });
});
