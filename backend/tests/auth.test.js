const { hashPassword, verifyPassword, signToken, verifyToken } = require('../src/utils/auth');

describe('hashPassword + verifyPassword', () => {
  test('round-trip', async () => {
    const hash = await hashPassword('Sifre123!');
    expect(hash).not.toBe('Sifre123!');
    expect(await verifyPassword('Sifre123!', hash)).toBe(true);
    expect(await verifyPassword('YanlisSifre', hash)).toBe(false);
  });
});

describe('signToken + verifyToken', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  test('sign + verify çalışır', () => {
    const token = signToken({ id: 1, rol: 'site_yonetici' });
    const payload = verifyToken(token);
    expect(payload.id).toBe(1);
    expect(payload.rol).toBe('site_yonetici');
  });

  test('geçersiz imza reddedilir', () => {
    const token = signToken({ id: 1 });
    process.env.JWT_SECRET = 'farkli-secret';
    expect(() => verifyToken(token)).toThrow();
    process.env.JWT_SECRET = 'test-secret';
  });
});
