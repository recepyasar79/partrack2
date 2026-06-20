const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');
const { ceteleGunuTR } = require('../../src/utils/timezone');
const dayjs = require('dayjs');

let guv, guvToken;

beforeAll(async () => {
  guv = await createTestUser({ kullanici_adi: 'gcikis', rol: 'guvenlik' });
  guvToken = makeToken({ id: guv.id, kullanici_adi: 'gcikis', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([guv]);
});

const auth = (r) => r.set('Authorization', `Bearer ${guvToken}`);

describe('Giriş/Çıkış — Çıkış Yap (soft exit)', () => {
  test('çıkış damgalanır, araç içeride sayımından düşer, log\'da kalır', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34GC001' });
    const add = await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34GC001' });
    const kid = add.body.kontrol.id;

    let ozet = await auth(request(app).get('/api/kontroller/gece-cetelesi/ozet'));
    expect(ozet.body.icerideki_arac).toBe(1);

    const cikis = await auth(request(app).post(`/api/kontroller/${kid}/cikis`));
    expect(cikis.status).toBe(200);
    expect(cikis.body.kontrol.cikis_zamani).toBeTruthy();

    // İçeride sayımından düşer
    ozet = await auth(request(app).get('/api/kontroller/gece-cetelesi/ozet'));
    expect(ozet.body.icerideki_arac).toBe(0);

    // Çetelede de düşer
    const cetele = await auth(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(cetele.body.daireler.find((d) => d.daire_no === 'A1').arac_sayisi).toBe(0);

    // "Site içindeki araçlar" listesinden de düşer (GET / yalnız içeride döner)
    const liste = await auth(request(app).get('/api/kontroller'));
    expect(liste.body.kontroller.find((k) => k.id === kid)).toBeUndefined();

    // Ama log'da giriş+çıkışıyla yaşar
    const log = await auth(request(app).get('/api/kontroller/log'));
    const kayit = log.body.kayitlar.find((k) => k.id === kid);
    expect(kayit).toBeTruthy();
    expect(kayit.iceride).toBe(false);
    expect(kayit.cikis).toBeTruthy();
    expect(kayit.sure_dk).toBeGreaterThanOrEqual(0);
  });

  test('çıkış idempotent — ikinci çağrı zaten_cikti döner', async () => {
    const a1 = await createTestDaire({ daire_no: 'A2' });
    await createTestArac({ daire_id: a1.id, plaka: '34GC002' });
    const add = await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34GC002' });
    const kid = add.body.kontrol.id;
    await auth(request(app).post(`/api/kontroller/${kid}/cikis`));
    const ikinci = await auth(request(app).post(`/api/kontroller/${kid}/cikis`));
    expect(ikinci.status).toBe(200);
    expect(ikinci.body.zaten_cikti).toBe(true);
  });

  test('olmayan kayda çıkış → 404', async () => {
    const r = await auth(request(app).post('/api/kontroller/999999/cikis'));
    expect(r.status).toBe(404);
  });

  test('token olmadan 401', async () => {
    const r = await request(app).post('/api/kontroller/1/cikis');
    expect(r.status).toBe(401);
  });
});

describe('Giriş/Çıkış logu — auto-close geçmiş açık oturumlar', () => {
  test('GET /log geçmiş günün açık oturumunu mantıksal 08:00 ile kapatır', async () => {
    const dunOp = dayjs(ceteleGunuTR()).subtract(2, 'day').format('YYYY-MM-DD');
    const [row] = await db('gunluk_kontroller')
      .insert({ kontrol_tarihi: dunOp, plaka: '34GC003', site_id: 1 })
      .returning('*');
    expect(row.cikis_zamani).toBeNull();

    const log = await auth(request(app).get('/api/kontroller/log'));
    const kayit = log.body.kayitlar.find((k) => k.id === row.id);
    expect(kayit).toBeTruthy();
    expect(kayit.iceride).toBe(false); // auto-close ile kapandı
    expect(kayit.cikis).toBeTruthy();
  });

  test('GET /log bugünün açık oturumunu içeride bırakır', async () => {
    const add = await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34GC004' });
    const log = await auth(request(app).get('/api/kontroller/log'));
    const kayit = log.body.kayitlar.find((k) => k.id === add.body.kontrol.id);
    expect(kayit.iceride).toBe(true);
    expect(kayit.cikis).toBeNull();
  });
});
