/**
 * DB-bağımsız unit testler — isDueToday + buildHtml.
 * Cron'un DB-touch eden runEmailRaporu() entegrasyon testi
 * tests/jobs/emailRaporu.integration.test.js içindedir.
 */
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { isDueToday, buildHtml, frequencyLabel, reportWindow, buildDetay } = require('../src/jobs/emailRaporu');

const TR = 'Europe/Istanbul';

describe('emailRaporu.isDueToday', () => {
  // 2026-05-25 Pazartesi 10:00 TR
  const pazartesi = dayjs.tz('2026-05-25 10:00', TR);
  // 2026-05-26 Salı
  const sali = dayjs.tz('2026-05-26 10:00', TR);
  // 2026-06-01 Pazartesi (ayın 1'i)
  const ayinIlki = dayjs.tz('2026-06-01 10:00', TR);

  test('daily — her gün true (last_sent_at yoksa)', () => {
    expect(isDueToday({ frequency: 'daily', last_sent_at: null }, pazartesi)).toBe(true);
    expect(isDueToday({ frequency: 'daily', last_sent_at: null }, sali)).toBe(true);
  });

  test('daily — aynı gün last_sent_at varsa false (idempotent)', () => {
    expect(isDueToday({
      frequency: 'daily',
      last_sent_at: dayjs.tz('2026-05-25 08:00', TR).toISOString(),
    }, pazartesi)).toBe(false);
  });

  test('weekly — Pazartesi true, Salı false', () => {
    expect(isDueToday({ frequency: 'weekly', last_sent_at: null }, pazartesi)).toBe(true);
    expect(isDueToday({ frequency: 'weekly', last_sent_at: null }, sali)).toBe(false);
  });

  test('monthly — ayın 1\'i true, diğerleri false', () => {
    expect(isDueToday({ frequency: 'monthly', last_sent_at: null }, ayinIlki)).toBe(true);
    expect(isDueToday({ frequency: 'monthly', last_sent_at: null }, pazartesi)).toBe(false);
  });

  test('weekly + bir hafta önce gönderildi → tekrar Pazartesi tetiklenir', () => {
    expect(isDueToday({
      frequency: 'weekly',
      last_sent_at: dayjs.tz('2026-05-18 10:00', TR).toISOString(),
    }, pazartesi)).toBe(true);
  });

  test('bilinmeyen frequency → false', () => {
    expect(isDueToday({ frequency: 'never', last_sent_at: null }, pazartesi)).toBe(false);
  });
});

describe('emailRaporu.reportWindow', () => {
  // 2026-06-03 Çarşamba 03:00 TR — cron bu saatte çalışır.
  const now = dayjs.tz('2026-06-03 03:00', TR);

  test('daily — dönem dün biter, dün başlar ([dün, dün])', () => {
    // Bugünü dahil etmemeli: bugünün akşam kontrolü henüz yapılmadı → 0 olurdu.
    expect(reportWindow('daily', now)).toEqual({
      baslangic: '2026-06-02',
      bitis: '2026-06-02',
    });
  });

  test('weekly — 7 günlük tamamlanmış pencere ([dün-6, dün])', () => {
    expect(reportWindow('weekly', now)).toEqual({
      baslangic: '2026-05-27',
      bitis: '2026-06-02',
    });
  });

  test('monthly — 30 günlük tamamlanmış pencere ([dün-29, dün])', () => {
    expect(reportWindow('monthly', now)).toEqual({
      baslangic: '2026-05-04',
      bitis: '2026-06-02',
    });
  });
});

describe('emailRaporu.buildHtml', () => {
  const data = {
    siteAd: 'Akasya Sitesi',
    frequency: 'weekly',
    baslangic: '2026-05-21',
    bitis: '2026-05-27',
    ihlalRow: { coklu_arac: 5, kayitsiz: 2, kayitsiz_plaka: 27, etkilenen_daire: 3 },
    bildirimRow: { toplam: 4, gonderildi: 3 },
    top: [
      { daire_no: 'B5', sahip_ad: 'Ayşe', ihlal_sayisi: 3 },
      { daire_no: 'A1', sahip_ad: 'Ali', ihlal_sayisi: 2 },
    ],
  };

  test('HTML site adı + dönem + toplam ihlal içerir', () => {
    const html = buildHtml(data);
    expect(html).toContain('Akasya Sitesi');
    expect(html).toContain('2026-05-21 → 2026-05-27');
    expect(html).toMatch(/>7</); // toplam_ihlal = 5+2
  });

  test('HTML Top tablosunda daire numaralarını gösterir', () => {
    const html = buildHtml(data);
    expect(html).toContain('B5');
    expect(html).toContain('Ayşe');
    expect(html).toContain('A1');
  });

  test('HTML başarı yüzdesini doğru hesaplar', () => {
    const html = buildHtml(data);
    expect(html).toMatch(/%75/);
  });

  test('"İhlal Kaydı" etiketi + ayrı "Kayıtsız Plaka" göstergesi (kayıt vs plaka karışmasın)', () => {
    const html = buildHtml(data);
    expect(html).toContain('İhlal Kaydı');
    expect(html).not.toContain('Toplam İhlal');
    expect(html).toContain('Kayıtsız Plaka');
    expect(html).toMatch(/>27</); // kayitsiz_plaka ayrı gösterilir
  });

  test('Top listesi boş ise alternatif mesaj', () => {
    const html = buildHtml({ ...data, top: [], ihlalRow: { coklu_arac: 0, kayitsiz: 0, etkilenen_daire: 0 } });
    expect(html).toContain('Bu dönemde ihlal kaydı yok.');
  });

  test('HTML escape — XSS güvenliği', () => {
    const html = buildHtml({ ...data, siteAd: '<script>alert(1)</script>', top: [] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('emailRaporu.buildDetay', () => {
  const detay = [
    { kontrol_tarihi: '2026-06-02', ihlal_tipi: 'coklu_arac', daire_no: 'B5', sahip_ad: 'Ayşe', plaka_listesi: ['34ABC123', '06XYZ99'] },
    { kontrol_tarihi: '2026-06-02', ihlal_tipi: 'kayitsiz', daire_no: null, sahip_ad: null, plaka_listesi: ['35ZZZ01'] },
  ];

  test('çoklu araç detayında daire + sahip + plakalar görünür', () => {
    const html = buildDetay(detay);
    expect(html).toContain('Çoklu Araç İhlalleri');
    expect(html).toContain('B5');
    expect(html).toContain('Ayşe');
    expect(html).toContain('34ABC123');
    expect(html).toContain('06XYZ99');
  });

  test('kayıtsız plaka detayı ayrı tabloda', () => {
    const html = buildDetay(detay);
    expect(html).toContain('Kayıtsız Plakalar');
    expect(html).toContain('35ZZZ01');
  });

  test('plaka_listesi JSON string ise de parse eder', () => {
    const html = buildDetay([{ kontrol_tarihi: '2026-06-02', ihlal_tipi: 'coklu_arac', daire_no: 'A1', sahip_ad: 'Ali', plaka_listesi: '["34AA11","34BB22"]' }]);
    expect(html).toContain('34AA11');
    expect(html).toContain('34BB22');
  });

  test('plaka XSS escape edilir', () => {
    const html = buildDetay([{ kontrol_tarihi: '2026-06-02', ihlal_tipi: 'kayitsiz', plaka_listesi: ['<script>x</script>'] }]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('boş detay → boş string (bölüm render edilmez)', () => {
    expect(buildDetay([])).toBe('');
    expect(buildDetay()).toBe('');
  });
});

describe('frequencyLabel', () => {
  test('TR label döner', () => {
    expect(frequencyLabel('daily')).toBe('Günlük');
    expect(frequencyLabel('weekly')).toBe('Haftalık');
    expect(frequencyLabel('monthly')).toBe('Aylık');
  });
  test('bilinmeyen → girdiyi geri ver', () => {
    expect(frequencyLabel('xxx')).toBe('xxx');
  });
});
