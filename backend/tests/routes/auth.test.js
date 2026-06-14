const { app, request, db, makeToken, createTestUser, createTestSite, cleanupTables } = require('../helpers');
const userStatusCache = require('../../src/utils/userStatusCache');

beforeEach(async () => {
  await cleanupTables();
  // Reset rate limiter store for each test
  const loginRoute = app._router.stack.find(
    (l) => l.route && l.route.path === '/login'
  );
  if (loginRoute) {
    loginRoute.route.stack.forEach((layer) => {
      if (layer.handle && layer.handle.reset) {
        layer.handle.reset();
      }
    });
  }
});

describe('POST /api/auth/login', () => {
  test('dogru credentials ile giris yapilir', async () => {
    await createTestUser({ kullanici_adi: 'testgiris', sifre: 'GirisPass123!', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'testgiris', sifre: 'GirisPass123!', site_slug: 'varsayilan' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.kullanici.kullanici_adi).toBe('testgiris');
    expect(res.body.kullanici.rol).toBe('guvenlik');
  });

  test('yanlis sifre ile 401 doner', async () => {
    await createTestUser({ kullanici_adi: 'testyanlis', sifre: 'DogruSifre1!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'testyanlis', sifre: 'YanlisSifre1!', site_slug: 'varsayilan' });
    expect(res.status).toBe(401);
  });

  test('olmayan kullanici ile 401 doner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'olmayan', sifre: 'Sifre123!', site_slug: 'varsayilan' });
    expect(res.status).toBe(401);
  });

  test('deaktif kullanici giris yapamaz', async () => {
    await createTestUser({ kullanici_adi: 'deaktif', aktif: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'deaktif', sifre: 'Sifre123!', site_slug: 'varsayilan' });
    expect(res.status).toBe(401);
  });

  test('eksik alan ile 400 doner', async () => {
    const res = await request(app).post('/api/auth/login').send({ kullanici_adi: 'test' });
    expect(res.status).toBe(400);
  });

  test('login sonrasi son_giris guncellenir', async () => {
    const user = await createTestUser({ kullanici_adi: 'sonlogin', sifre: 'LoginPass1!' });
    expect(user.son_giris).toBeNull();
    await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'sonlogin', sifre: 'LoginPass1!', site_slug: 'varsayilan' });
    const updated = await db('users').where({ id: user.id }).first();
    expect(updated.son_giris).not.toBeNull();
  });
});

describe('GET /api/auth/me', () => {
  test('token ile kullanici bilgisi doner', async () => {
    const user = await createTestUser({ kullanici_adi: 'meuser', rol: 'site_yonetici' });
    const token = makeToken({ id: user.id, kullanici_adi: 'meuser', rol: 'site_yonetici' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kullanici.kullanici_adi).toBe('meuser');
  });

  test('tokensiz istek 401 doner', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('gecersiz token 401 doner', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-xyz');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register', () => {
  test('yonetici yeni kullanici olusturabilir', async () => {
    const admin = await createTestUser({ kullanici_adi: 'regadmin', rol: 'site_yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'regadmin', rol: 'site_yonetici' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'yeniuser', sifre: 'YeniSifre123!', rol: 'guvenlik' });
    expect(res.status).toBe(201);
    expect(res.body.kullanici.kullanici_adi).toBe('yeniuser');
    expect(res.body.kullanici.rol).toBe('guvenlik');
  });

  test('guvenlik kullanici olusturamaz (403)', async () => {
    const guard = await createTestUser({ kullanici_adi: 'guardreg', rol: 'guvenlik' });
    const token = makeToken({ id: guard.id, kullanici_adi: 'guardreg', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'yenibiri', sifre: 'YeniSifre123!', rol: 'guvenlik' });
    expect(res.status).toBe(403);
  });

  test('ayni kullanici adi ile 409 doner', async () => {
    const admin = await createTestUser({ kullanici_adi: 'dupadmin', rol: 'site_yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'dupadmin', rol: 'site_yonetici' });
    await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'duplicateuser', sifre: 'Sifre123!', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'duplicateuser', sifre: 'Sifre123!', rol: 'guvenlik' });
    expect(res.status).toBe(409);
  });

  test('kisa sifre ile 400 doner', async () => {
    const admin = await createTestUser({ kullanici_adi: 'shortpwadmin', rol: 'site_yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'shortpwadmin', rol: 'site_yonetici' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'shortpw', sifre: '123', rol: 'guvenlik' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/sifre-sifirla', () => {
  test('yonetici baskasinin sifresini sifirlayabilir', async () => {
    const admin = await createTestUser({ kullanici_adi: 'resetadmin', rol: 'site_yonetici' });
    const target = await createTestUser({ kullanici_adi: 'resettarget', sifre: 'EskiSifre1!' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'resetadmin', rol: 'site_yonetici' });
    const res = await request(app)
      .post('/api/auth/sifre-sifirla')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_id: target.id, yeni_sifre: 'YeniSifre123!' });
    expect(res.status).toBe(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'resettarget', sifre: 'YeniSifre123!', site_slug: 'varsayilan' });
    expect(loginRes.status).toBe(200);
  });

  test('guvenlik sifre sifirlayamaz (403)', async () => {
    const guard = await createTestUser({ kullanici_adi: 'guardreset', rol: 'guvenlik' });
    const token = makeToken({ id: guard.id, kullanici_adi: 'guardreset', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/sifre-sifirla')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_id: 1, yeni_sifre: 'YeniSifre123!' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/sifre-degistir', () => {
  test('kullanici kendi sifresini degistirebilir', async () => {
    const user = await createTestUser({ kullanici_adi: 'changeme', sifre: 'EskiSifre1!' });
    const token = makeToken({ id: user.id, kullanici_adi: 'changeme', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/sifre-degistir')
      .set('Authorization', `Bearer ${token}`)
      .send({ eski_sifre: 'EskiSifre1!', yeni_sifre: 'YeniSifre123!' });
    expect(res.status).toBe(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'changeme', sifre: 'YeniSifre123!', site_slug: 'varsayilan' });
    expect(loginRes.status).toBe(200);
  });

  test('yanlis eski sifre ile 401 doner', async () => {
    const user = await createTestUser({ kullanici_adi: 'wrongold', sifre: 'DogruSifre1!' });
    const token = makeToken({ id: user.id, kullanici_adi: 'wrongold', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/sifre-degistir')
      .set('Authorization', `Bearer ${token}`)
      .send({ eski_sifre: 'YanlisSifre1!', yeni_sifre: 'YeniSifre123!' });
    expect(res.status).toBe(401);
  });
});

// #1 güvenlik fix: authRequired artık kullanıcı durumunu canlı kontrol eder —
// deaktive edilen kullanıcı/site token süresi boyunca erişimde kalmaz.
describe('authRequired — canlı oturum kontrolü (deaktivasyon)', () => {
  test('aktif kullanici token ile erisir (200)', async () => {
    const user = await createTestUser({ kullanici_adi: 'aktifuser', rol: 'guvenlik' });
    const token = makeToken({ id: user.id, kullanici_adi: 'aktifuser', rol: 'guvenlik' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('var olmayan kullanici id li (gecerli imzali) token 401 doner', async () => {
    const token = makeToken({ id: 999999, kullanici_adi: 'hayalet', rol: 'guvenlik' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('PATCH ile deaktive edilen kullanici aninda erisemez (401)', async () => {
    const admin = await createTestUser({ kullanici_adi: 'deaktadmin', rol: 'site_yonetici' });
    const guard = await createTestUser({ kullanici_adi: 'deaktguard', rol: 'guvenlik' });
    const adminToken = makeToken({ id: admin.id, kullanici_adi: 'deaktadmin', rol: 'site_yonetici' });
    const guardToken = makeToken({ id: guard.id, kullanici_adi: 'deaktguard', rol: 'guvenlik' });

    // Guard önce erişebiliyor (durumu cache'e aktif olarak yazılır)
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${guardToken}`);
    expect(before.status).toBe(200);

    // Admin guard'ı deaktive eder — endpoint cache'i invalidate eder
    const patch = await request(app)
      .patch(`/api/auth/kullanicilar/${guard.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ aktif: false });
    expect(patch.status).toBe(200);

    // Guard artık erişemez — TTL beklemeden anında
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${guardToken}`);
    expect(after.status).toBe(401);
  });

  test('deaktif site kullanicisi erisemez (401)', async () => {
    const site = await createTestSite({ ad: 'Kapali Site', slug: `kapali-${Date.now()}`, aktif: true });
    const user = await createTestUser({ kullanici_adi: 'kapalisiteuser', rol: 'guvenlik', site_id: site.id });
    const token = makeToken({ id: user.id, kullanici_adi: 'kapalisiteuser', rol: 'guvenlik', site_id: site.id });

    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await db('sites').where({ id: site.id }).update({ aktif: false });
    userStatusCache.invalidate(user.id); // direkt DB güncellemesi — cache'i atla

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});
