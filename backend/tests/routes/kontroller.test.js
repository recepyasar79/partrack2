const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');
// Endpoint'ler operasyon gününü (ceteleGunuTR, 08:00 sınırı) kullanıyor; seed
// tarihlerini de aynı helper'a hizala ki CI 00:00-08:00 TR penceresinde koşsa
// da seed↔sorgu tarihi tutarlı kalsın (gece_cetelesi testleriyle aynı yaklaşım).
const { ceteleGunuTR, normalizeMisafirZaman } = require('../../src/utils/timezone');

// foto-upload artık magic-byte ile içerik doğruluyor (storage.sniffImageType);
// geçerli JPEG header'ı olan buffer kullan. İçerik OCR'da decode edilemese de
// upload akışı 201 döner (OCR Promise.allSettled ile soft-fail).
function jpegBuffer(size = 1024) {
  const b = Buffer.alloc(Math.max(size, 12));
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; // JPEG SOI + APP0
  return b;
}

let adminToken;
let admin;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'kadmin', rol: 'site_yonetici' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'kadmin', rol: 'site_yonetici' });
});

beforeEach(async () => {
  await cleanupTables([admin]);
});

describe('POST /api/kontroller/foto-upload', () => {
  test('foto yuklenir ve kontrol kaydi olusturulur', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34UPLOAD' });
    const buffer = jpegBuffer();
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, 'test.jpg')
      .field('plaka', '34UPLOAD');
    expect(res.status).toBe(201);
    expect(res.body.kontrol.foto_url).toBeDefined();
  });

  test('plaka olmadan da yuklenir', async () => {
    const buffer = jpegBuffer();
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, 'nopla.jpg');
    expect(res.status).toBe(201);
    expect(res.body.kontrol.plaka).toBe('');
  });

  test('token olmadan 401 doner', async () => {
    const buffer = Buffer.alloc(1024);
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .attach('foto', buffer, 'noauth.jpg');
    expect(res.status).toBe(401);
  });

  test('image olmayan icerik (image/jpeg MIME ile) 400 doner', async () => {
    // İstemci MIME'ı image/jpeg ama içerik görüntü değil (magic-byte fail).
    const buffer = Buffer.from('GECERSIZ ICERIK, GORUNTU DEGIL'.repeat(40));
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, { filename: 'sahte.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/kontroller/manuel', () => {
  test('gecerli plaka fotosuz kontrol kaydi olusturur', async () => {
    const res = await request(app)
      .post('/api/kontroller/manuel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: '34 man 123' });
    expect(res.status).toBe(201);
    expect(res.body.kontrol.plaka).toBe('34MAN123');
    expect(res.body.kontrol.foto_url).toBeNull();

    const listRes = await request(app)
      .get('/api/kontroller')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.kontroller.some((k) => k.plaka === '34MAN123')).toBe(true);
  });

  test('gecersiz plaka 400 doner', async () => {
    const res = await request(app)
      .post('/api/kontroller/manuel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: 'GECERSIZ' });
    expect(res.status).toBe(400);
  });

  test('yabanci plaka (insan teyitli) kabul edilir', async () => {
    const res = await request(app)
      .post('/api/kontroller/manuel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: 'CB 8950 HE' });
    expect(res.status).toBe(201);
    expect(res.body.kontrol.plaka).toBe('CB8950HE');
  });

  test('token olmadan 401 doner', async () => {
    const res = await request(app)
      .post('/api/kontroller/manuel')
      .send({ plaka: '34MAN999' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/kontroller', () => {
  test('bugunk kontroller listelenir', async () => {
    await db('gunluk_kontroller').insert({
      site_id: 1,
      kontrol_tarihi: ceteleGunuTR(),
      plaka: '34LIST01',
      foto_url: '/uploads/test.jpg',
    });
    const res = await request(app)
      .get('/api/kontroller')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kontroller.length).toBeGreaterThanOrEqual(1);
  });

  test('kayitli plaka daire_no ile, misafir degil isaretlenir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34KAYIT1' });
    await db('gunluk_kontroller').insert({
      site_id: 1, kontrol_tarihi: ceteleGunuTR(), plaka: '34KAYIT1',
    });
    const res = await request(app)
      .get('/api/kontroller')
      .set('Authorization', `Bearer ${adminToken}`);
    const k = res.body.kontroller.find((x) => x.plaka === '34KAYIT1');
    expect(k.daire_no).toBe('A1');
    expect(k.daire_misafir).toBe(false);
  });

  test('bugun gun ortasinda baslayan misafir kaydi kayitsiz degil misafir gosterir', async () => {
    // Regresyon: baslangic_tarihi tam timestamp; ham `tarih` (gun basi=00:00) ile
    // kiyaslanirsa 14:30'da baslayan misafir disarda kalip "kayitsiz" gorunurdu.
    const daire = await createTestDaire({ daire_no: 'B2' });
    const bugun = ceteleGunuTR();
    await db('misafir_araclar').insert({
      site_id: 1,
      daire_id: daire.id,
      plaka: '34MIS123',
      baslangic_tarihi: normalizeMisafirZaman(`${bugun}T14:30`, false),
      bitis_tarihi: normalizeMisafirZaman(`${bugun}T23:59`, true),
      ekleyen_user_id: admin.id,
    });
    await db('gunluk_kontroller').insert({
      site_id: 1, kontrol_tarihi: bugun, plaka: '34MIS123',
    });
    const res = await request(app)
      .get('/api/kontroller')
      .set('Authorization', `Bearer ${adminToken}`);
    const k = res.body.kontroller.find((x) => x.plaka === '34MIS123');
    expect(k.daire_no).toBe('B2');
    expect(k.daire_misafir).toBe(true);
  });
});

describe('PATCH /api/kontroller/:id/plaka', () => {
  test('kontrol plakasi duzeltilir', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        kontrol_tarihi: ceteleGunuTR(),
        plaka: '',
        foto_url: '/uploads/fix.jpg',
      })
      .returning('*');
    const res = await request(app)
      .patch(`/api/kontroller/${kontrol.id}/plaka`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: '34FIXED' });
    expect(res.status).toBe(200);
    expect(res.body.kontrol.plaka).toBe('34FIXED');
  });

  test('yabanci plakaya duzeltme kabul edilir', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        kontrol_tarihi: ceteleGunuTR(),
        plaka: '',
        foto_url: '/uploads/foreign.jpg',
      })
      .returning('*');
    const res = await request(app)
      .patch(`/api/kontroller/${kontrol.id}/plaka`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: 'CB8950HE' });
    expect(res.status).toBe(200);
    expect(res.body.kontrol.plaka).toBe('CB8950HE');
  });

  test('anlamsiz plaka duzeltmesi 400 doner', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        kontrol_tarihi: ceteleGunuTR(),
        plaka: '34OLD123',
        foto_url: '/uploads/bad.jpg',
      })
      .returning('*');
    const res = await request(app)
      .patch(`/api/kontroller/${kontrol.id}/plaka`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: 'AB' });
    expect(res.status).toBe(400);
  });
});

describe('OCR metrics', () => {
  test('foto-upload sonrası ocr_metrics satırı oluşur', async () => {
    const before = await db('ocr_metrics').count('* as c').first();
    const beforeCount = parseInt(before.c, 10);
    const buffer = jpegBuffer();
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, 'metric.jpg');
    expect(res.status).toBe(201);
    const kontrolId = res.body.kontrol.id;

    // recordOcrCall fire-and-forget; bekleyelim
    await new Promise((r) => setTimeout(r, 100));
    const row = await db('ocr_metrics').where({ gunluk_kontrol_id: kontrolId }).first();
    expect(row).toBeTruthy();
    expect(row.ocr_engine).toBe('easyocr');
    // Test ortamında Python OCR yok → ok=false beklenir
    expect(row.ocr_ok).toBe(false);

    const after = await db('ocr_metrics').count('* as c').first();
    expect(parseInt(after.c, 10)).toBe(beforeCount + 1);
  });

  test('PATCH /plaka düzeltmesi metric satırını işaretler', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        kontrol_tarihi: ceteleGunuTR(),
        plaka: '34WRONG1',
        foto_url: '/uploads/m.jpg',
      })
      .returning('*');
    // Bağlı metric satırı oluştur (foto upload yapmadığımız için elle)
    const [m] = await db('ocr_metrics')
      .insert({
        site_id: 1,
        gunluk_kontrol_id: kontrol.id,
        ocr_engine: 'easyocr',
        plate_returned: '34WRONG1',
        confidence: 0.5,
      })
      .returning('id');

    const res = await request(app)
      .patch(`/api/kontroller/${kontrol.id}/plaka`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: '34RIGHT1' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    const metricId = m.id ?? m;
    const updated = await db('ocr_metrics').where({ id: metricId }).first();
    expect(updated.was_corrected_by_user).toBe(true);
    expect(updated.corrected_to).toBe('34RIGHT1');
    expect(updated.corrected_at).toBeTruthy();
  });
});

describe('GET /api/ocr-stats/summary', () => {
  test('superadmin doğruluk özetini görür', async () => {
    // Ü1.10 sonrası platform metriği: yalnız superadmin (requireSuperadmin).
    const sa = await createTestUser({ kullanici_adi: 'ocr_sa', rol: 'superadmin', site_id: null });
    const saToken = makeToken({ id: sa.id, kullanici_adi: 'ocr_sa', rol: 'superadmin', site_id: null });
    const res = await request(app)
      .get('/api/ocr-stats/summary?days=7')
      .set('Authorization', `Bearer ${saToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('accuracy');
    expect(res.body).toHaveProperty('p95_ms');
    expect(Array.isArray(res.body.by_engine)).toBe(true);
  });

  test('site_yonetici 403 alır (platform metriği)', async () => {
    const res = await request(app)
      .get('/api/ocr-stats/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  test('güvenlik rolü 403 alır', async () => {
    const guard = await createTestUser({ kullanici_adi: 'ocr_guard', rol: 'guvenlik' });
    const guardToken = makeToken({ id: guard.id, kullanici_adi: 'ocr_guard', rol: 'guvenlik' });
    const res = await request(app)
      .get('/api/ocr-stats/summary')
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/kontroller/:id', () => {
  test('kontrol kaydi silinir', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        kontrol_tarihi: ceteleGunuTR(),
        plaka: '34DELETE',
        foto_url: '/uploads/del.jpg',
      })
      .returning('*');
    const res = await request(app)
      .delete(`/api/kontroller/${kontrol.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const exists = await db('gunluk_kontroller').where({ id: kontrol.id }).first();
    expect(exists).toBeUndefined();
  });
});

describe('POST /api/kontroller/analiz-et', () => {
  test('2 plakali daire ihlal verir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34ANA001' });
    await createTestArac({ daire_id: daire.id, plaka: '34ANA002' });
    const today = ceteleGunuTR();
    await db('gunluk_kontroller').insert([
      { site_id: 1, kontrol_tarihi: today, plaka: '34ANA001', foto_url: '/uploads/a1.jpg' },
      { site_id: 1, kontrol_tarihi: today, plaka: '34ANA002', foto_url: '/uploads/a2.jpg' },
    ]);
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    expect(res.body.ihlaller).toHaveLength(1);
    expect(res.body.ihlaller[0].daire_no).toBe('A1');
  });

  test('coklu ihlalde misafir plakalar misafir_plaka_listesi\'ne yazilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34OWN001' });
    const today = ceteleGunuTR();
    // 1 kayıtlı + 1 misafir = 2 araç → ihlal; misafir ayrı listede olmalı.
    await db('misafir_araclar').insert({
      site_id: 1, daire_id: daire.id, plaka: '34GUEST1',
      baslangic_tarihi: normalizeMisafirZaman(`${today}T08:00`, false),
      bitis_tarihi: normalizeMisafirZaman(`${today}T23:59`, true),
      ekleyen_user_id: admin.id,
    });
    await db('gunluk_kontroller').insert([
      { site_id: 1, kontrol_tarihi: today, plaka: '34OWN001', foto_url: '/uploads/o.jpg' },
      { site_id: 1, kontrol_tarihi: today, plaka: '34GUEST1', foto_url: '/uploads/g.jpg' },
    ]);
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    const row = await db('ihlaller')
      .where({ site_id: 1, daire_id: daire.id, kontrol_tarihi: today, ihlal_tipi: 'coklu_arac' })
      .first();
    expect(row).toBeTruthy();
    const misafir = typeof row.misafir_plaka_listesi === 'string'
      ? JSON.parse(row.misafir_plaka_listesi) : row.misafir_plaka_listesi;
    expect(misafir).toEqual(['34GUEST1']);
  });

  test('kayitsiz plaka ihlal verir', async () => {
    const today = ceteleGunuTR();
    await db('gunluk_kontroller').insert({
      site_id: 1,
      kontrol_tarihi: today,
      plaka: '99UNREG0',
      foto_url: '/uploads/unreg.jpg',
    });
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    expect(res.body.kayitsiz_plakalar).toContain('99UNREG0');
  });

  test('gun-ortasi/aksam baslayan misafir kayitsiz raporlanmaz, dairesine sayilir', async () => {
    // Regresyon: misafir penceresi tam 20:00'i kapsamasa da (orn. 20:30'da
    // kaydedilen ya da gunduz pencereli) o gun aktifse kayitsiz olmamali.
    const daire = await createTestDaire({ daire_no: 'C3' });
    const today = ceteleGunuTR();
    await db('misafir_araclar').insert({
      site_id: 1,
      daire_id: daire.id,
      plaka: '34MISAKS',
      baslangic_tarihi: normalizeMisafirZaman(`${today}T20:30`, false),
      bitis_tarihi: normalizeMisafirZaman(`${today}T23:59`, true),
      ekleyen_user_id: admin.id,
    });
    await db('gunluk_kontroller').insert({
      site_id: 1, kontrol_tarihi: today, plaka: '34MISAKS', foto_url: '/uploads/mis.jpg',
    });
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    expect(res.body.kayitsiz_plakalar || []).not.toContain('34MISAKS');
    // tek arac → ihlal yok, ama misafir gorulen listesinde olmali
    expect((res.body.misafir_gorulen || []).map((m) => m.plaka)).toContain('34MISAKS');
  });

  test('idempotent: ayni gun 2. cagri mevcut kaydi update eder', async () => {
    const daire = await createTestDaire({ daire_no: 'B1' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM01' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM02' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM03' });
    const today = ceteleGunuTR();
    await db('gunluk_kontroller').insert([
      { site_id: 1, kontrol_tarihi: today, plaka: '34IDEM01', foto_url: '/uploads/i1.jpg' },
      { site_id: 1, kontrol_tarihi: today, plaka: '34IDEM02', foto_url: '/uploads/i2.jpg' },
    ]);
    const res1 = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res1.status).toBe(200);
    expect(res1.body.ihlaller).toHaveLength(1);
    expect(res1.body.ihlaller[0].plakalar).toHaveLength(2);

    await db('gunluk_kontroller').insert({
      site_id: 1,
      kontrol_tarihi: today,
      plaka: '34IDEM03',
      foto_url: '/uploads/i3.jpg',
    });
    const res2 = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res2.status).toBe(200);
    expect(res2.body.ihlaller).toHaveLength(1);
    expect(res2.body.ihlaller[0].plakalar).toHaveLength(3);
  });
});

describe('GET /api/kontroller/ihlaller', () => {
  test('ihlal listesi tarih filtresiyle doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34IHLL01' });
    await createTestArac({ daire_id: daire.id, plaka: '34IHLL02' });
    const today = ceteleGunuTR();
    await db('gunluk_kontroller').insert([
      { site_id: 1, kontrol_tarihi: today, plaka: '34IHLL01', foto_url: '/uploads/h1.jpg' },
      { site_id: 1, kontrol_tarihi: today, plaka: '34IHLL02', foto_url: '/uploads/h2.jpg' },
    ]);
    await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    const res = await request(app)
      .get('/api/kontroller/ihlaller')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ihlaller.length).toBeGreaterThanOrEqual(1);
  });
});
