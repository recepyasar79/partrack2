/**
 * KVKK data retention cron testleri (Faz Ü4).
 *
 * Eski kayıtlar silinir, retention süresi içindekiler kalır. Tüm tablolar
 * için ayrı sürelere uyulur.
 */
const { runRetention } = require('../../src/jobs/dataRetention');
const { db, cleanupTables, createTestUser, createTestDaire } = require('../helpers');

afterAll(async () => {
  await db('audit_log').del();
  await db('bildirimler').del();
  await db('ihlaller').del();
  await db('daire_sahip_tarihce').del();
  await db.destroy();
});

beforeEach(async () => {
  await cleanupTables();
  await db('audit_log').del();
  await db('bildirimler').del();
  await db('ihlaller').del();
  await db('daire_sahip_tarihce').del();
});

function pastDate(years) {
  // year * 365.25 days * 24h * 3600s * 1000ms
  return new Date(Date.now() - years * 365.25 * 24 * 3600 * 1000);
}

describe('dataRetention.runRetention', () => {
  test('5 yıldan eski ihlaller silinir, yeniler kalır', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    // Eski ihlal: 6 yıl önce
    await db('ihlaller').insert({
      kontrol_tarihi: pastDate(6).toISOString().slice(0, 10),
      daire_id: daire.id,
      site_id: 1,
      daire_no_snapshot: 'A1',
      plaka_listesi: JSON.stringify(['34ABC123']),
      ihlal_tipi: 'coklu_arac',
      olusturma_zamani: pastDate(6),
    });
    // Yeni ihlal: 1 yıl önce
    await db('ihlaller').insert({
      kontrol_tarihi: pastDate(1).toISOString().slice(0, 10),
      daire_id: daire.id,
      site_id: 1,
      daire_no_snapshot: 'A1',
      plaka_listesi: JSON.stringify(['34ABC123']),
      ihlal_tipi: 'kayitsiz',
      olusturma_zamani: pastDate(1),
    });

    const r = await runRetention();
    expect(r.ihlaller).toBe(1);
    const remaining = await db('ihlaller');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ihlal_tipi).toBe('kayitsiz');
  });

  test('5 yıldan eski bildirimler silinir', async () => {
    const daire = await createTestDaire({ daire_no: 'A2' });
    const [ihlal] = await db('ihlaller').insert({
      kontrol_tarihi: pastDate(2).toISOString().slice(0, 10),
      daire_id: daire.id, site_id: 1, daire_no_snapshot: 'A2',
      plaka_listesi: JSON.stringify([]), ihlal_tipi: 'kayitsiz',
    }).returning('*');
    await db('bildirimler').insert({
      ihlal_id: ihlal.id, site_id: 1, daire_no: 'A2',
      telefon: '05551234567', mesaj: 'eski',
      gonderim_durumu: 'gonderildi',
      olusturma_zamani: pastDate(6),
    });
    await db('bildirimler').insert({
      ihlal_id: ihlal.id, site_id: 1, daire_no: 'A2',
      telefon: '05551234567', mesaj: 'yeni',
      gonderim_durumu: 'gonderildi',
      olusturma_zamani: pastDate(2),
    });

    const r = await runRetention();
    expect(r.bildirimler).toBe(1);
    const rest = await db('bildirimler');
    expect(rest).toHaveLength(1);
    expect(rest[0].mesaj).toBe('yeni');
  });

  test('audit_log retention zaman kolonuna göre', async () => {
    const user = await createTestUser({ kullanici_adi: 'ret_user', rol: 'site_yonetici' });
    await db('audit_log').insert({
      user_id: user.id, eylem: 'test', tablo_adi: 'x', site_id: 1,
      zaman: pastDate(6),
    });
    await db('audit_log').insert({
      user_id: user.id, eylem: 'test', tablo_adi: 'x', site_id: 1,
      zaman: pastDate(1),
    });
    const r = await runRetention();
    expect(r.audit_log).toBe(1);
    expect(await db('audit_log').count('* as c').first()).toMatchObject({ c: '1' });
  });

  test('daire_sahip_tarihce retention', async () => {
    const daire = await createTestDaire({ daire_no: 'A3' });
    await db('daire_sahip_tarihce').insert({
      daire_id: daire.id, site_id: 1,
      sahip_ad: 'Çok Eski', sahip_tel: '05551112233',
      baslangic_tarihi: pastDate(10), bitis_tarihi: pastDate(7),
      olusturma_zamani: pastDate(7),
    });
    await db('daire_sahip_tarihce').insert({
      daire_id: daire.id, site_id: 1,
      sahip_ad: 'Yeni Eski', sahip_tel: '05552223344',
      baslangic_tarihi: pastDate(3), bitis_tarihi: pastDate(1),
      olusturma_zamani: pastDate(1),
    });
    const r = await runRetention();
    expect(r.daire_sahip_tarihce).toBe(1);
    const rest = await db('daire_sahip_tarihce');
    expect(rest).toHaveLength(1);
    expect(rest[0].sahip_ad).toBe('Yeni Eski');
  });

  test('env override ile retention süresi değişir', async () => {
    const daire = await createTestDaire({ daire_no: 'A4' });
    await db('ihlaller').insert({
      kontrol_tarihi: pastDate(2).toISOString().slice(0, 10),
      daire_id: daire.id, site_id: 1, daire_no_snapshot: 'A4',
      plaka_listesi: JSON.stringify([]), ihlal_tipi: 'kayitsiz',
      olusturma_zamani: pastDate(2),
    });
    process.env.RETENTION_YEARS_VIOLATIONS = '1';
    try {
      const r = await runRetention();
      expect(r.ihlaller).toBe(1);
    } finally {
      delete process.env.RETENTION_YEARS_VIOLATIONS;
    }
  });
});
