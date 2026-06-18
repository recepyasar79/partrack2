const {
  app, request, db, makeToken, createTestUser, createTestDaire, createTestArac, cleanupTables,
} = require('../helpers');
// Endpoint'ler operasyon gününü (ceteleGunuTR) kullanıyor — seed'i hizala ki
// CI 00:00-08:00 TR penceresinde seed↔analiz/çetele tarihi tutarlı kalsın.
const { ceteleGunuTR } = require('../../src/utils/timezone');

let admin, guard, adminToken, guardToken;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'iaadmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'iaguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'iaadmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'iaguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard]); // default site id=1 kapasite 10'a resetlenir
});

const aAdmin = (r) => r.set('Authorization', `Bearer ${adminToken}`);
const aGuard = (r) => r.set('Authorization', `Bearer ${guardToken}`);
const gorulen = (plaka) => db('gunluk_kontroller').insert({ kontrol_tarihi: ceteleGunuTR(), plaka, site_id: 1 });

describe('2. araç hakkı — daire CRUD + kota', () => {
  test('POST ikinci_arac_izinli=true ile daire oluşturulur', async () => {
    const res = await aAdmin(request(app).post('/api/daireler')).send({
      daire_no: 'A1', sahip_ad: 'Ali Veli', sahip_tel: '05551234567',
      kvkk_riza: true, ikinci_arac_izinli: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.daire.ikinci_arac_izinli).toBe(true);
  });

  test('kota dolduğunda POST 409 + uyarı mesajı', async () => {
    await db('sites').where({ id: 1 }).update({ ikinci_arac_kapasitesi: 1 });
    // 1. izinli daire → OK
    const ilk = await aAdmin(request(app).post('/api/daireler')).send({
      daire_no: 'A1', sahip_ad: 'Ali Bir', sahip_tel: '05551234567', kvkk_riza: true, ikinci_arac_izinli: true,
    });
    expect(ilk.status).toBe(201);
    // 2. izinli daire → kota dolu
    const res = await aAdmin(request(app).post('/api/daireler')).send({
      daire_no: 'A2', sahip_ad: 'Veli İki', sahip_tel: '05551234567', kvkk_riza: true, ikinci_arac_izinli: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Sitede en fazla 1 daire için ikinci araç izni verebilirsiniz.');
    // Kota dolu olsa bile izinsiz daire eklenebilir
    const ok = await aAdmin(request(app).post('/api/daireler')).send({
      daire_no: 'A3', sahip_ad: 'Cem Üç', sahip_tel: '05551234567', kvkk_riza: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.daire.ikinci_arac_izinli).toBe(false);
  });

  test('PUT ile hak verilebilir/kaldırılabilir', async () => {
    const d = await createTestDaire({ daire_no: 'A5' });
    let res = await aAdmin(request(app).put(`/api/daireler/${d.id}`)).send({ ikinci_arac_izinli: true });
    expect(res.status).toBe(200);
    expect(res.body.daire.ikinci_arac_izinli).toBe(true);
    res = await aAdmin(request(app).put(`/api/daireler/${d.id}`)).send({ ikinci_arac_izinli: false });
    expect(res.body.daire.ikinci_arac_izinli).toBe(false);
  });

  test('PUT kota dolu → 409, mevcut izinli daire kendi satırını saymaz', async () => {
    await db('sites').where({ id: 1 }).update({ ikinci_arac_kapasitesi: 1 });
    const d1 = await createTestDaire({ daire_no: 'A1', ikinci_arac_izinli: true });
    const d2 = await createTestDaire({ daire_no: 'A2' });
    // d1 zaten izinli (1/1) → d2'ye vermek kota aşar
    const res = await aAdmin(request(app).put(`/api/daireler/${d2.id}`)).send({ ikinci_arac_izinli: true });
    expect(res.status).toBe(409);
    // d1'i (zaten izinli) başka alanla güncellemek kotaya takılmaz
    const ok = await aAdmin(request(app).put(`/api/daireler/${d1.id}`)).send({ ikinci_arac_izinli: true, sahip_ad: 'Yeni' });
    expect(ok.status).toBe(200);
  });

  test('güvenlik rolü PUT yapamaz (403)', async () => {
    const d = await createTestDaire({ daire_no: 'A9' });
    const res = await aGuard(request(app).put(`/api/daireler/${d.id}`)).send({ ikinci_arac_izinli: true });
    expect(res.status).toBe(403);
  });
});

describe('2. araç hakkı — analiz-et entegrasyonu', () => {
  test('izinli daire 2 araç → ihlal YOK', async () => {
    const d = await createTestDaire({ daire_no: 'B5', ikinci_arac_izinli: true });
    await createTestArac({ daire_id: d.id, plaka: '34BA001' });
    await createTestArac({ daire_id: d.id, plaka: '34BA002' });
    await gorulen('34BA001');
    await gorulen('34BA002');
    const res = await aGuard(request(app).post('/api/kontroller/analiz-et')).send({});
    expect(res.status).toBe(200);
    expect(res.body.ihlaller).toHaveLength(0);
  });

  test('izinli daire 3 araç → ihlal VAR', async () => {
    const d = await createTestDaire({ daire_no: 'B6', ikinci_arac_izinli: true });
    await createTestArac({ daire_id: d.id, plaka: '34BB001' });
    await createTestArac({ daire_id: d.id, plaka: '34BB002' });
    await createTestArac({ daire_id: d.id, plaka: '34BB003' });
    await gorulen('34BB001');
    await gorulen('34BB002');
    await gorulen('34BB003');
    const res = await aGuard(request(app).post('/api/kontroller/analiz-et')).send({});
    expect(res.status).toBe(200);
    expect(res.body.ihlaller).toHaveLength(1);
    expect(res.body.ihlaller[0].daire_no).toBe('B6');
  });

  test('izinsiz daire 2 araç → ihlal VAR (varsayılan davranış korunur)', async () => {
    const d = await createTestDaire({ daire_no: 'B7' });
    await createTestArac({ daire_id: d.id, plaka: '34BC001' });
    await createTestArac({ daire_id: d.id, plaka: '34BC002' });
    await gorulen('34BC001');
    await gorulen('34BC002');
    const res = await aGuard(request(app).post('/api/kontroller/analiz-et')).send({});
    expect(res.body.ihlaller).toHaveLength(1);
  });
});

describe('2. araç hakkı — gece çetelesi', () => {
  test('GET ikinci_arac_izinli bayrağını döner', async () => {
    await createTestDaire({ daire_no: 'C1', ikinci_arac_izinli: true });
    await createTestDaire({ daire_no: 'C2' });
    const res = await aGuard(request(app).get('/api/kontroller/gece-cetelesi'));
    expect(res.status).toBe(200);
    const byNo = Object.fromEntries(res.body.daireler.map((d) => [d.daire_no, d.ikinci_arac_izinli]));
    expect(byNo.C1).toBe(true);
    expect(byNo.C2).toBe(false);
  });
});
