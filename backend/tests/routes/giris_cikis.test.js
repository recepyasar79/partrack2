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

  test('misafir aracın çıkışında misafir kaydının bitiş (çıkış) saati de güncellenir', async () => {
    await createTestDaire({ daire_no: 'B5' });
    const add = await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34MIS100' });
    const kid = add.body.kontrol.id;
    // Kayıtsız aracı hızlı misafir yap (bitis = günün sonu)
    const mis = await auth(request(app).post('/api/misafir-araclar/hizli'))
      .send({ kontrol_id: kid, daire_no: 'B5' });
    expect(mis.status).toBe(201);
    const eskiBitis = new Date(mis.body.misafir.bitis_tarihi).getTime();

    const cikis = await auth(request(app).post(`/api/kontroller/${kid}/cikis`));
    expect(cikis.status).toBe(200);
    const cikisZ = new Date(cikis.body.kontrol.cikis_zamani).getTime();

    // Misafir kaydının bitişi gün sonundan çıkış anına çekilmeli
    const row = await db('misafir_araclar').where({ id: mis.body.misafir.id }).first();
    const yeniBitis = new Date(row.bitis_tarihi).getTime();
    expect(yeniBitis).toBeLessThan(eskiBitis);
    expect(Math.abs(yeniBitis - cikisZ)).toBeLessThan(3000);
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

describe('Daire-Araç raporu — GET /daire-arac', () => {
  test('yalnız kayıtlı araçlar, daire→plaka→giriş sıralı, daire_no+sahip_ad döner', async () => {
    const b2 = await createTestDaire({ daire_no: 'B2', sahip_ad: 'Bahçe Sahibi' });
    const a5 = await createTestDaire({ daire_no: 'A5', sahip_ad: 'Ali Veli' });
    await createTestArac({ daire_id: b2.id, plaka: '34DA002' });
    await createTestArac({ daire_id: a5.id, plaka: '34DA001' });
    await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34DA002' });
    await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34DA001' });
    // Kayıtsız plaka — rapora GİRMEMELİ
    await auth(request(app).post('/api/kontroller/manuel')).send({ plaka: '34KAYITSIZ9' });

    const res = await auth(request(app).get('/api/kontroller/daire-arac'));
    expect(res.status).toBe(200);
    const k = res.body.kayitlar;
    // Kayıtsız plaka yok
    expect(k.find((r) => r.plaka === '34KAYITSIZ9')).toBeUndefined();
    const ilgili = k.filter((r) => ['34DA001', '34DA002'].includes(r.plaka));
    expect(ilgili.length).toBe(2);
    // A5 (blok A) B2'den (blok B) önce gelir
    const iA5 = k.findIndex((r) => r.plaka === '34DA001');
    const iB2 = k.findIndex((r) => r.plaka === '34DA002');
    expect(iA5).toBeLessThan(iB2);
    // daire_no + sahip_ad dolu
    const row = k.find((r) => r.plaka === '34DA001');
    expect(row.daire_no).toBe('A5');
    expect(row.sahip_ad).toBe('Ali Veli');
    expect(row.giris).toBeTruthy();
  });

  test('token olmadan 401', async () => {
    const r = await request(app).get('/api/kontroller/daire-arac');
    expect(r.status).toBe(401);
  });
});
