const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');

let adminToken, admin, guvToken, guv;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'ozetadmin', rol: 'site_yonetici' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'ozetadmin', rol: 'site_yonetici' });
  guv = await createTestUser({ kullanici_adi: 'ozetguv', rol: 'guvenlik' });
  guvToken = makeToken({ id: guv.id, kullanici_adi: 'ozetguv', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guv]);
  await db('sites').where({ id: 1 }).update({ bildirim_telefonlari: '[]' });
});

const aAdmin = (r) => r.set('Authorization', `Bearer ${adminToken}`);
const aGuv = (r) => r.set('Authorization', `Bearer ${guvToken}`);
const today = () => new Date().toISOString().slice(0, 10);

async function ihlalOlustur() {
  const daire = await createTestDaire({ daire_no: 'A1', bildirim_opt_in: true });
  await createTestArac({ daire_id: daire.id, plaka: '34OZT001' });
  await createTestArac({ daire_id: daire.id, plaka: '34OZT002' });
  const t = today();
  await db('gunluk_kontroller').insert([
    { site_id: 1, kontrol_tarihi: t, plaka: '34OZT001' },
    { site_id: 1, kontrol_tarihi: t, plaka: '34OZT002' },
  ]);
  await aAdmin(request(app).post('/api/kontroller/analiz-et')).send({ tarih: t });
}

describe('Bildirim numaraları (site-telefonlari)', () => {
  test('admin numara kaydeder + normalize eder', async () => {
    const res = await aAdmin(request(app).put('/api/bildirimler/site-telefonlari'))
      .send({ telefonlar: ['05301234567', '+905309998877', '5306060606', ''] });
    expect(res.status).toBe(200);
    expect(res.body.telefonlar).toEqual(['05301234567', '05309998877', '05306060606']);
  });

  test('geçersiz format 400', async () => {
    const res = await aAdmin(request(app).put('/api/bildirimler/site-telefonlari'))
      .send({ telefonlar: ['1234'] });
    expect(res.status).toBe(400);
  });

  test('5ten fazla numara 400', async () => {
    const res = await aAdmin(request(app).put('/api/bildirimler/site-telefonlari'))
      .send({ telefonlar: ['05301111111', '05302222222', '05303333333', '05304444444', '05305555555', '05306666666'] });
    expect(res.status).toBe(400);
  });

  test('güvenlik numara güncelleyemez (403)', async () => {
    const res = await aGuv(request(app).put('/api/bildirimler/site-telefonlari'))
      .send({ telefonlar: ['05301234567'] });
    expect(res.status).toBe(403);
  });

  test('GET kayıtlı numaraları döner', async () => {
    await aAdmin(request(app).put('/api/bildirimler/site-telefonlari')).send({ telefonlar: ['05301234567'] });
    const res = await aGuv(request(app).get('/api/bildirimler/site-telefonlari'));
    expect(res.status).toBe(200);
    expect(res.body.telefonlar).toEqual(['05301234567']);
  });
});

describe('POST /api/bildirimler/gunluk-ozet-gonder', () => {
  test('numara tanımlı değilse 400', async () => {
    await ihlalOlustur();
    const res = await aGuv(request(app).post('/api/bildirimler/gunluk-ozet-gonder')).send({ tarih: today() });
    expect(res.status).toBe(400);
  });

  test('ihlal + numara varsa özet gönderilir (mock)', async () => {
    await aAdmin(request(app).put('/api/bildirimler/site-telefonlari')).send({ telefonlar: ['05301234567', '05309998877'] });
    await ihlalOlustur();
    const res = await aGuv(request(app).post('/api/bildirimler/gunluk-ozet-gonder')).send({ tarih: today() });
    expect(res.status).toBe(200);
    expect(res.body.ihlal_sayisi).toBe(1);
    expect(res.body.alici_sayisi).toBe(2);
    expect(res.body.basari).toBe(2);
    expect(res.body.mock).toBe(true);
  });

  test('bugün ihlal yoksa gönderilmez (ihlal_sayisi 0)', async () => {
    await aAdmin(request(app).put('/api/bildirimler/site-telefonlari')).send({ telefonlar: ['05301234567'] });
    const res = await aGuv(request(app).post('/api/bildirimler/gunluk-ozet-gonder')).send({ tarih: today() });
    expect(res.status).toBe(200);
    expect(res.body.ihlal_sayisi).toBe(0);
    expect(res.body.gonderildi).toBe(false);
  });
});
