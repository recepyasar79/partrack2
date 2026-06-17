const { app, request, makeToken, createTestUser, createTestDaire, createTestSite, db, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let superToken;
let admin;
let guard;
let superadmin;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'rapadmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'rapguard', rol: 'guvenlik' });
  superadmin = await createTestUser({ kullanici_adi: 'rapsuper', rol: 'superadmin' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'rapadmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'rapguard', rol: 'guvenlik' });
  superToken = makeToken({ id: superadmin.id, kullanici_adi: 'rapsuper', rol: 'superadmin' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard, superadmin]);
});

async function seedIhlaller({ siteId = 1, daireId, dates, tipi = 'coklu_arac', plakalar = ['34X001', '34X002'], misafirPlakalar = [] }) {
  for (const t of dates) {
    await db('ihlaller').insert({
      kontrol_tarihi: t,
      daire_id: tipi === 'kayitsiz' ? null : daireId,
      daire_no_snapshot: tipi === 'kayitsiz' ? null : 'A1',
      plaka_listesi: JSON.stringify(plakalar),
      misafir_plaka_listesi: JSON.stringify(misafirPlakalar),
      ihlal_tipi: tipi,
      site_id: siteId,
    });
  }
}

describe('GET /api/raporlar/dashboard', () => {
  test('yonetici dashboard ozetini alir', async () => {
    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('donem');
    expect(res.body).toHaveProperty('ozet');
    expect(res.body).toHaveProperty('bildirim');
    expect(res.body.ozet.toplam_ihlal).toBe(0);
    expect(res.body.gunluk_trend).toEqual([]);
    expect(res.body.aylik_trend).toEqual([]);
    expect(res.body.blok_dagilim).toEqual([]);
    expect(res.body.top_daireler).toEqual([]);
  });

  test('guvenlik de dashboard erisimi var', async () => {
    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(200);
  });

  test('superadmin domain dashboard\'a erisemez (403)', async () => {
    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(403);
  });

  test('auth gerekli (401)', async () => {
    const res = await request(app).get('/api/raporlar/dashboard');
    expect(res.status).toBe(401);
  });

  test('ihlaller toplanir ve tipe gore ayrilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await seedIhlaller({ daireId: daire.id, dates: [today], tipi: 'coklu_arac' });
    await seedIhlaller({ daireId: daire.id, dates: [yesterday], tipi: 'coklu_arac' });
    await seedIhlaller({ dates: [today], tipi: 'kayitsiz', plakalar: ['99NOCAR0'] });

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ozet.toplam_ihlal).toBe(3);
    expect(res.body.ozet.coklu_arac).toBe(2);
    expect(res.body.ozet.kayitsiz).toBe(1);
    expect(res.body.ozet.etkilenen_daire).toBe(1);
    expect(res.body.gunluk_trend.length).toBeGreaterThanOrEqual(1);
    const todayRow = res.body.gunluk_trend.find((g) => g.tarih === today);
    expect(todayRow).toBeDefined();
    expect(todayRow.coklu_arac).toBe(1);
    expect(todayRow.kayitsiz).toBe(1);
  });

  test('blok_dagilim sadece coklu_arac sayar', async () => {
    const aDaire = await createTestDaire({ daire_no: 'A1' });
    const bDaire = await createTestDaire({ daire_no: 'B5' });
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await seedIhlaller({ daireId: aDaire.id, dates: [today], tipi: 'coklu_arac' });
    await seedIhlaller({ daireId: bDaire.id, dates: [today, yest], tipi: 'coklu_arac' });
    await seedIhlaller({ dates: [today], tipi: 'kayitsiz' });

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const blokA = res.body.blok_dagilim.find((b) => b.blok === 'A');
    const blokB = res.body.blok_dagilim.find((b) => b.blok === 'B');
    expect(blokA.ihlal).toBe(1);
    expect(blokB.ihlal).toBe(2);
  });

  test('top_daireler ihlal_sayisi desc siralanir', async () => {
    const d1 = await createTestDaire({ daire_no: 'A1' });
    const d2 = await createTestDaire({ daire_no: 'B5' });
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const before = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    await seedIhlaller({ daireId: d1.id, dates: [today] });
    await seedIhlaller({ daireId: d2.id, dates: [today, yest, before] });

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.top_daireler[0].daire_no).toBe('B5');
    expect(res.body.top_daireler[0].ihlal_sayisi).toBe(3);
    expect(res.body.top_daireler[1].daire_no).toBe('A1');
  });

  test('tarih aralık filtresi calisir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const eski = '2026-01-15';
    const yeni = new Date().toISOString().slice(0, 10);
    await seedIhlaller({ daireId: daire.id, dates: [eski, yeni] });

    const dar = await request(app)
      .get(`/api/raporlar/dashboard?baslangic=${yeni}&bitis=${yeni}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dar.body.ozet.toplam_ihlal).toBe(1);

    const genis = await request(app)
      .get(`/api/raporlar/dashboard?baslangic=2026-01-01&bitis=${yeni}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(genis.body.ozet.toplam_ihlal).toBe(2);
  });

  test('bildirim basari_orani yuvarlanir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const today = new Date().toISOString().slice(0, 10);
    await seedIhlaller({ daireId: daire.id, dates: [today] });
    const ihlal = await db('ihlaller').first();
    await db('bildirimler').insert([
      { ihlal_id: ihlal.id, daire_no: 'A1', telefon: '05551110001', mesaj: 'x',
        gonderim_durumu: 'gonderildi', deneme_sayisi: 1, site_id: 1 },
      { ihlal_id: ihlal.id, daire_no: 'A1', telefon: '05551110002', mesaj: 'x',
        gonderim_durumu: 'gonderildi', deneme_sayisi: 1, site_id: 1 },
      { ihlal_id: ihlal.id, daire_no: 'A1', telefon: '05551110003', mesaj: 'x',
        gonderim_durumu: 'basarisiz', deneme_sayisi: 3, site_id: 1 },
    ]);

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.bildirim.toplam).toBe(3);
    expect(res.body.bildirim.gonderildi).toBe(2);
    expect(res.body.bildirim.basarisiz).toBe(1);
    expect(res.body.bildirim.basari_orani).toBeCloseTo(66.7, 1);
  });

  test('site izolasyonu — diger site verisi sizmaz', async () => {
    const otherSite = await createTestSite({ slug: `dashother-${Date.now()}` });
    const otherDaire = await db('daireler')
      .insert({
        daire_no: 'A1', blok: 'A', sira_no: 1,
        sahip_ad: 'X', sahip_tel: '05550000000',
        kvkk_riza: true, bildirim_opt_in: true, aktif: true,
        site_id: otherSite.id,
      })
      .returning('*');
    const today = new Date().toISOString().slice(0, 10);
    await seedIhlaller({ siteId: otherSite.id, daireId: otherDaire[0].id, dates: [today] });

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.ozet.toplam_ihlal).toBe(0);
  });

  test('arac-adedi metrikleri: kayitsiz_arac plaka sayar, coklu_fazla_arac k-1 sayar', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const today = new Date().toISOString().slice(0, 10);
    // 1 coklu_arac kaydı, 3 plakalı → fazla araç = 2
    await seedIhlaller({
      daireId: daire.id, dates: [today], tipi: 'coklu_arac',
      plakalar: ['34X001', '34X002', '34X003'],
    });
    // 1 kayitsiz kaydı, 4 plakalı → kayıtsız araç = 4
    await seedIhlaller({
      dates: [today], tipi: 'kayitsiz',
      plakalar: ['99A1', '99A2', '99A3', '99A4'],
    });
    // foto sayısı
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34X001', site_id: 1, yukleyen_user_id: admin.id },
      { kontrol_tarihi: today, plaka: '34X002', site_id: 1, yukleyen_user_id: admin.id },
    ]);

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ozet.kayitsiz_arac).toBe(4);
    expect(res.body.ozet.coklu_fazla_arac).toBe(2);
    expect(res.body.ozet.toplam_foto).toBe(2);
    // Eski alanlar (kayıt sayısı) geriye uyumlu kalır
    expect(res.body.ozet.coklu_arac).toBe(1);
    expect(res.body.ozet.kayitsiz).toBe(1);
  });

  test('coklu_fazla_arac 2. arac hakkini hesaba katar (izinli daire 2 araca muaf)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // İzinli daire, 3 plakalı çoklu ihlal → fazla = 3 - 2 = 1
    const izinli = await createTestDaire({ daire_no: 'A1', ikinci_arac_izinli: true });
    await seedIhlaller({
      daireId: izinli.id, dates: [today], tipi: 'coklu_arac',
      plakalar: ['34IZ001', '34IZ002', '34IZ003'],
    });
    // Normal daire, 3 plakalı → fazla = 3 - 1 = 2
    const normal = await createTestDaire({ daire_no: 'B5', ikinci_arac_izinli: false });
    await seedIhlaller({
      daireId: normal.id, dates: [today], tipi: 'coklu_arac',
      plakalar: ['34NM001', '34NM002', '34NM003'],
    });

    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // 1 (izinli) + 2 (normal) = 3
    expect(res.body.ozet.coklu_fazla_arac).toBe(3);
  });

  test('misafir_arac ayri sayilir ve coklu_fazla_arac\'tan dusulur', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const daire = await createTestDaire({ daire_no: 'A1', ikinci_arac_izinli: false });
    // 3 plaka, 2'si misafir → toplam 3; kendi fazla = (3-2)-1 = 0; misafir = 2
    await seedIhlaller({
      daireId: daire.id, dates: [today], tipi: 'coklu_arac',
      plakalar: ['34OWN001', '34GUEST1', '34GUEST2'],
      misafirPlakalar: ['34GUEST1', '34GUEST2'],
    });
    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ozet.misafir_arac).toBe(2);
    expect(res.body.ozet.coklu_fazla_arac).toBe(0); // misafirler düşülünce kendi fazlası yok
  });

  test('misafir + kendi fazla araci birlikte: dogru kirilim', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const daire = await createTestDaire({ daire_no: 'B2', ikinci_arac_izinli: false });
    // 4 plaka, 1 misafir → kendi fazla = (4-1)-1 = 2; misafir = 1
    await seedIhlaller({
      daireId: daire.id, dates: [today], tipi: 'coklu_arac',
      plakalar: ['34OWN001', '34OWN002', '34OWN003', '34GUEST1'],
      misafirPlakalar: ['34GUEST1'],
    });
    const res = await request(app)
      .get('/api/raporlar/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.ozet.misafir_arac).toBe(1);
    expect(res.body.ozet.coklu_fazla_arac).toBe(2);
  });

  test('donem_ozet coklu_fazla_arac izinli daire icin 2 araca muaf', async () => {
    const todayTr = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const izinli = await createTestDaire({ daire_no: 'C3', ikinci_arac_izinli: true });
    await seedIhlaller({
      daireId: izinli.id, dates: [todayTr], tipi: 'coklu_arac',
      plakalar: ['34IZ001', '34IZ002', '34IZ003'], // fazla = 1 (3-2)
    });
    const res = await request(app)
      .get('/api/raporlar/dashboard?baslangic=2026-01-01&bitis=2026-01-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.donem_ozet.bugun.coklu_fazla_arac).toBe(1);
  });

  test('donem_ozet bugun/bu_hafta/bu_ay dondurur (secili aralıktan bagimsiz)', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    // donem_ozet TR gününe göre hesaplanır (UTC değil) — TR = UTC+3 sabit.
    const todayTr = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    await seedIhlaller({
      daireId: daire.id, dates: [todayTr], tipi: 'coklu_arac',
      plakalar: ['34X001', '34X002'], // fazla araç = 1
    });

    // Geçmiş bir aralık seçilse bile donem_ozet bugünü gösterir
    const res = await request(app)
      .get('/api/raporlar/dashboard?baslangic=2026-01-01&bitis=2026-01-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.donem_ozet.bugun.coklu_fazla_arac).toBe(1);
    expect(res.body.donem_ozet.bu_hafta.coklu_fazla_arac).toBeGreaterThanOrEqual(1);
    expect(res.body.donem_ozet.bu_ay.coklu_fazla_arac).toBeGreaterThanOrEqual(1);
    expect(res.body.donem_ozet.bugun.kayitsiz_arac).toBe(0);
  });

  test('aylik_trend son 12 ay dondurur', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await seedIhlaller({ daireId: daire.id, dates: ['2026-01-15', '2026-02-20', '2026-03-10'] });

    const res = await request(app)
      .get('/api/raporlar/dashboard?baslangic=2026-03-01&bitis=2026-03-31')
      .set('Authorization', `Bearer ${adminToken}`);
    const aylar = res.body.aylik_trend.map((a) => a.ay);
    expect(aylar).toContain('2026-01');
    expect(aylar).toContain('2026-02');
    expect(aylar).toContain('2026-03');
    const mart = res.body.aylik_trend.find((a) => a.ay === '2026-03');
    expect(mart.coklu_arac).toBe(1);
  });
});
