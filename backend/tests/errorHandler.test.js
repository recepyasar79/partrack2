const { errorHandler, notFound } = require('../src/middleware/errorHandler');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

describe('errorHandler — 5xx bilgi sızıntısı', () => {
  test('500 hatada iç detay sızmaz, jenerik mesaj döner', () => {
    const res = mockRes();
    // DB iç detayı içeren beklenmeyen hata (status set yok → 500)
    const err = new Error('relation "users" does not exist at column sifre_hash');
    errorHandler(err, {}, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Sunucu hatası.');
    // Sızıntı yok
    expect(res.body.error).not.toContain('users');
    expect(res.body.error).not.toContain('sifre_hash');
  });

  test('açıkça 503 işaretli hata da jenerik döner', () => {
    const res = mockRes();
    const err = new Error('ECONNREFUSED 10.0.0.5:5432');
    err.status = 503;
    errorHandler(err, {}, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('Sunucu hatası.');
    expect(res.body.error).not.toContain('5432');
  });

  test('4xx kasıtlı hatada mesaj korunur', () => {
    const res = mockRes();
    const err = new Error('Plaka formatı geçersiz.');
    err.status = 400;
    errorHandler(err, {}, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Plaka formatı geçersiz.');
  });

  test('4xx details alanı korunur', () => {
    const res = mockRes();
    const err = new Error('Doğrulama hatası');
    err.status = 422;
    err.details = { field: 'telefon' };
    errorHandler(err, {}, res, () => {});
    expect(res.statusCode).toBe(422);
    expect(res.body.details).toEqual({ field: 'telefon' });
  });

  test('notFound 404 döner', () => {
    const res = mockRes();
    notFound({}, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Bulunamadı.');
  });
});
