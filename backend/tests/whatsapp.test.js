const { buildMessage, toE164, isWhatsAppConfigured, sendTemplate } = require('../src/services/whatsapp');

describe('whatsapp service', () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  describe('toE164', () => {
    test('05551234567 → +905551234567', () => {
      expect(toE164('05551234567')).toBe('+905551234567');
    });
    test('5551234567 → +905551234567', () => {
      expect(toE164('5551234567')).toBe('+905551234567');
    });
    test('905551234567 → +905551234567', () => {
      expect(toE164('905551234567')).toBe('+905551234567');
    });
    test('boşluk/karakter temizler', () => {
      expect(toE164('0555 123 45 67')).toBe('+905551234567');
    });
  });

  describe('buildMessage', () => {
    test('daire ve plakaları içerir', () => {
      const m = buildMessage({ daire_no: 'B5', sahip_ad: 'Ali', plakalar: ['34ABC', '06DEF'] });
      expect(m).toContain('B5');
      expect(m).toContain('Ali');
      expect(m).toContain('34ABC, 06DEF');
    });
  });

  describe('isWhatsAppConfigured', () => {
    test('env yokken false', () => {
      expect(isWhatsAppConfigured()).toBe(false);
    });
    test('env varken true', () => {
      process.env.WHATSAPP_API_TOKEN = 'x';
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'y';
      expect(isWhatsAppConfigured()).toBe(true);
    });
  });

  describe('sendTemplate (mock mode)', () => {
    test('env yokken mock mode döner, network çağrılmaz', async () => {
      const r = await sendTemplate({
        telefon: '05551234567',
        daire_no: 'B5',
        sahip_ad: 'Ali',
        plakalar: ['34ABC123'],
      });
      expect(r.ok).toBe(true);
      expect(r.mock).toBe(true);
      expect(r.to).toBe('+905551234567');
      expect(r.mesaj).toContain('B5');
    });
  });
});
