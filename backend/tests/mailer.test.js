/**
 * mailer service unit testler — env'siz mock fallback ve SMTP yolu.
 *
 * Gerçek SMTP'ye bağlanmamak için nodemailer.createTransport mocklanır.
 */
jest.mock('nodemailer', () => {
  const sendMail = jest.fn();
  return {
    createTransport: jest.fn(() => ({ sendMail })),
    __mocks: { sendMail },
  };
});

describe('mailer', () => {
  const ORIG_ENV = { ...process.env };
  let mailer;
  let nodemailer; // resetModules sonrası fresh referans alınacak

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIG_ENV };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_SECURE;
    // Mailer'ın require ettiği aynı nodemailer instance'ını al
    nodemailer = require('nodemailer');
    nodemailer.__mocks.sendMail.mockReset();
    nodemailer.createTransport.mockClear();
    mailer = require('../src/services/mailer');
    mailer._resetTransporterCache();
  });

  afterAll(() => { process.env = ORIG_ENV; });

  test('isConfigured: env eksikse false', () => {
    expect(mailer.isConfigured()).toBe(false);
  });

  test('isConfigured: SMTP_HOST + SMTP_FROM varsa true', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = '"ParkTrack" <no-reply@parktrack.io>';
    expect(mailer.isConfigured()).toBe(true);
  });

  test('sendMail: env eksikse mock döner, transport oluşturulmaz', async () => {
    const r = await mailer.sendMail({ to: 'x@y.com', subject: 'a', html: '<b>x</b>' });
    expect(r).toEqual({ ok: true, mock: true });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test('sendMail: yapılandırılmış SMTP üzerinden gönderir', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';
    process.env.SMTP_FROM = '"PT" <a@b.com>';
    nodemailer.__mocks.sendMail.mockResolvedValueOnce({ messageId: '<abc>' });

    const r = await mailer.sendMail({ to: 'x@y.com', subject: 'a', html: '<b>x</b>', text: 'x' });
    expect(r.ok).toBe(true);
    expect(r.info.messageId).toBe('<abc>');
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(nodemailer.__mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: '"PT" <a@b.com>',
      to: 'x@y.com',
      subject: 'a',
    }));
  });

  test('sendMail: SMTP fırlatınca {ok:false, error} döner, throw etmez', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = '"PT" <a@b.com>';
    nodemailer.__mocks.sendMail.mockRejectedValueOnce(new Error('connection refused'));
    const r = await mailer.sendMail({ to: 'x@y.com', subject: 'a', html: '<b>x</b>' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('connection refused');
  });

  test('port 465 → secure=true', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_FROM = '"PT" <a@b.com>';
    nodemailer.__mocks.sendMail.mockResolvedValueOnce({ messageId: '<x>' });
    await mailer.sendMail({ to: 'x@y.com', subject: 'a', html: '<b>x</b>' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 465,
      secure: true,
    }));
  });
});
