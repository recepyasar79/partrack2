const { app, request, db, makeToken, createTestUser } = require('./helpers');

describe('POST /api/auth/login', () => {
  test('dogru credentials ile giris yapilir', async () => {
    await createTestUser({ kullanici_adi: 'testgiris', sifre: 'GirisPass123!', rol: 'guvenlik' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'testgiris', sifre: 'GirisPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.kullanici.kullanici_adi).toBe('testgiris');
    expect(res.body.kullanici.rol).toBe('guvenlik');
  });

  test('yanlis sifre ile 401 doner', async () => {
    await createTestUser({ kullanici_adi: 'testyanlis', sifre: 'DogruSifre1!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'testyanlis', sifre: 'YanlisSifre1!' });
    expect(res.status).toBe(401);
  });

  test('olmayan kullanici ile 401 doner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'olmayan', sifre: 'Sifre123!' });
    expect(res.status).toBe(401);
  });

  test('deaktif kullanici giris yapamaz', async () => {
    await createTestUser({ kullanici_adi: 'deaktif', aktif: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'deaktif', sifre: 'Sifre123!' });
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
      .send({ kullanici_adi: 'sonlogin', sifre: 'LoginPass1!' });
    const updated = await db('users').where({ id: user.id }).first();
    expect(updated.son_giris).not.toBeNull();
  });
});

describe('GET /api/auth/me', () => {
  test('token ile kullanici bilgisi doner', async () => {
    const user = await createTestUser({ kullanici_adi: 'meuser', rol: 'yonetici' });
    const token = makeToken({ id: user.id, kullanici_adi: 'meuser', rol: 'yonetici' });
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
    const admin = await createTestUser({ kullanici_adi: 'regadmin', rol: 'yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'regadmin', rol: 'yonetici' });
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
    const admin = await createTestUser({ kullanici_adi: 'dupadmin', rol: 'yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'dupadmin', rol: 'yonetici' });
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
    const admin = await createTestUser({ kullanici_adi: 'shortpwadmin', rol: 'yonetici' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'shortpwadmin', rol: 'yonetici' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_adi: 'shortpw', sifre: '123', rol: 'guvenlik' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/sifre-sifirla', () => {
  test('yonetici baskasinin sifresini sifirlayabilir', async () => {
    const admin = await createTestUser({ kullanici_adi: 'resetadmin', rol: 'yonetici' });
    const target = await createTestUser({ kullanici_adi: 'resettarget', sifre: 'EskiSifre1!' });
    const token = makeToken({ id: admin.id, kullanici_adi: 'resetadmin', rol: 'yonetici' });
    const res = await request(app)
      .post('/api/auth/sifre-sifirla')
      .set('Authorization', `Bearer ${token}`)
      .send({ kullanici_id: target.id, yeni_sifre: 'YeniSifre123!' });
    expect(res.status).toBe(200);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ kullanici_adi: 'resettarget', sifre: 'YeniSifre123!' });
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
      .send({ kullanici_adi: 'changeme', sifre: 'YeniSifre123!' });
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
