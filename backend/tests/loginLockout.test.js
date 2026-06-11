const lockout = require('../src/utils/loginLockout');

describe('loginLockout', () => {
  beforeEach(() => lockout._reset());
  afterEach(() => jest.useRealTimers());

  test('temiz IP kilitli değil', () => {
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
  });

  test('MAX_FAILS altı deneme kilitlemez', () => {
    for (let i = 0; i < lockout.MAX_FAILS - 1; i++) lockout.recordFail('1.2.3.4');
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
  });

  test('MAX_FAILS deneme → kilit + retryAfterSec', () => {
    for (let i = 0; i < lockout.MAX_FAILS; i++) lockout.recordFail('1.2.3.4');
    const lock = lockout.isLocked('1.2.3.4');
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSec).toBeGreaterThan(0);
    expect(lock.retryAfterSec).toBeLessThanOrEqual(lockout.LOCKOUT_MS / 1000);
  });

  test('IP başına bağımsız sayaç', () => {
    for (let i = 0; i < lockout.MAX_FAILS; i++) lockout.recordFail('1.1.1.1');
    expect(lockout.isLocked('1.1.1.1').locked).toBe(true);
    expect(lockout.isLocked('2.2.2.2').locked).toBe(false);
  });

  test('başarılı login (clearFails) sayacı sıfırlar', () => {
    for (let i = 0; i < lockout.MAX_FAILS - 1; i++) lockout.recordFail('1.2.3.4');
    lockout.clearFails('1.2.3.4');
    lockout.recordFail('1.2.3.4');
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
  });

  test('kilit süresi dolunca otomatik açılır', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-11T10:00:00Z'));
    for (let i = 0; i < lockout.MAX_FAILS; i++) lockout.recordFail('1.2.3.4');
    expect(lockout.isLocked('1.2.3.4').locked).toBe(true);

    jest.setSystemTime(new Date(Date.now() + lockout.LOCKOUT_MS + 1000));
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
    // Kilit açıldıktan sonra sayaç da sıfırdan başlamalı
    lockout.recordFail('1.2.3.4');
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
  });

  test('pencere dışında kalan eski denemeler sayılmaz', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-11T10:00:00Z'));
    for (let i = 0; i < lockout.MAX_FAILS - 1; i++) lockout.recordFail('1.2.3.4');

    jest.setSystemTime(new Date(Date.now() + lockout.WINDOW_MS + 1000));
    lockout.recordFail('1.2.3.4'); // eski 9 deneme pencere dışı — bu 1. deneme
    expect(lockout.isLocked('1.2.3.4').locked).toBe(false);
  });
});
