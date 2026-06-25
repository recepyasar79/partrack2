/**
 * OCR sağlık izleme cron'u.
 *
 * Saatte bir çalışır (Fly scheduled machine, `--schedule hourly`). Python OCR
 * servisinin (`parktrack-ocr`) /health'ini sorgular; sağlıksızsa `OCR_ALERT_EMAIL`
 * adresine Resend (SMTP) ile alarm maili atar.
 *
 * PENCERE KONTROLU (fatura fix 2026-06-24, guncellendi 2026-06-25): OCR
 * makineleri yalniz aksam penceresinde (OCR_PENCERE_BASLANGIC..OCR_PENCERE_BITIS
 * TR, default 20-23) acik; disinda kapali. auto_start_machines=true'ya geri
 * donuldugu icin (2026-06-25 option a) bu job'un pencere disi health-ping'i
 * makineyi UYANDIRIR → eski fatura sizintisini geri getirirdi. O yuzden pencere
 * disinda job hicbir sey yapmadan cikar (ping bile atmaz). Ayrica pencere disi
 * makine kasitli kapali oldugundan kontrol kacinilmaz "saglksiz" doner → yanlis
 * alarm yagardi. BASLANGIC=20: makineler 19:45'te (GH cron) acilir; ilk saatlik
 * health tick (20:00) onlari ayakta bulur. Yalniz pencere ICINDE gercek
 * crash/deploy sorunlarini yakalar.
 *
 * Daha ince (5 dk) izleme için harici UptimeRobot önerilir; bu, server-tarafı
 * saatlik yedek alarmdır. DB bağlantısı gerektirmez (sadece HTTP + mail).
 *
 * Env: OCR_ALERT_EMAIL (alıcı; yoksa mail atlanır, durum yine loglanır).
 *      OCR_PENCERE_BASLANGIC / OCR_PENCERE_BITIS (TR saati, default 20 / 23).
 *      PYTHON_OCR_URL, SMTP_* (mailer).
 */
const { healthCheck } = require('../services/pythonOcr');
const { sendMail, isConfigured } = require('../services/mailer');
const { dayjs, TR_TZ } = require('../utils/timezone');

// OCR akşam penceresi (TR saati). GH Actions cron 16:45 UTC (19:45 TR) baslatir,
// 20:00 UTC (23 TR) durdurur; saglik kontrolu makineler ayagga kalktiktan
// (ilk tick 20:00) sonra basliyor ki pencere disi false alarm/uyandirma olmasin.
const PENCERE_BASLANGIC = Number(process.env.OCR_PENCERE_BASLANGIC || 20);
const PENCERE_BITIS = Number(process.env.OCR_PENCERE_BITIS || 23);

async function runOcrSaglik() {
  const now = dayjs().tz(TR_TZ).format('YYYY-MM-DD HH:mm');
  const alertEmail = process.env.OCR_ALERT_EMAIL || '';

  // Pencere disi: makineler kasitli kapali → kontrolu/alarmi atla.
  const saat = dayjs().tz(TR_TZ).hour();
  if (saat < PENCERE_BASLANGIC || saat >= PENCERE_BITIS) {
    // eslint-disable-next-line no-console
    console.log(`[ocrSaglik] ${now} pencere disi (${PENCERE_BASLANGIC}-${PENCERE_BITIS} TR) — kontrol atlandi`);
    return { ok: true, skipped: true, alerted: false };
  }

  const h = await healthCheck(); // { ok, status, paddle_loaded, ... } | { ok:false, error }
  const saglikli = h.ok && h.status === 'ok';

  if (saglikli) {
    // eslint-disable-next-line no-console
    console.log(`[ocrSaglik] ${now} OK`, JSON.stringify({ engine: h.engine, paddle: h.paddle_loaded, v: h.version }));
    return { ok: true, alerted: false, health: h };
  }

  const detay = h.error || JSON.stringify(h);
  // eslint-disable-next-line no-console
  console.error(`[ocrSaglik] ${now} OCR SAĞLIKSIZ:`, detay);

  if (!alertEmail) {
    // eslint-disable-next-line no-console
    console.warn('[ocrSaglik] OCR_ALERT_EMAIL set değil — alarm maili atlandı.');
    return { ok: false, alerted: false, health: h };
  }
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[ocrSaglik] SMTP yapılandırılmadı — alarm maili atlandı.');
    return { ok: false, alerted: false, health: h };
  }

  const subject = `⚠️ ParkTrack OCR servisi yanıt vermiyor (${now})`;
  const text = `ParkTrack OCR servisi (parktrack-ocr) saglik kontrolunden gecemedi.\n\n`
    + `Zaman: ${now} (TR)\nHata: ${detay}\n\n`
    + `Kontrol:\n  flyctl machine list --app parktrack-ocr\n  flyctl logs --app parktrack-ocr\n`
    + `Monitoring: https://fly.io/apps/parktrack-ocr/monitoring`;
  const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:560px">
    <h2 style="color:#dc2626;margin:0 0 8px">⚠️ OCR servisi yanıt vermiyor</h2>
    <p><b>parktrack-ocr</b> sağlık kontrolünden geçemedi — plaka okuma şu an çalışmıyor olabilir.</p>
    <table style="font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 8px;color:#64748b">Zaman</td><td style="padding:4px 8px"><b>${now}</b> (TR)</td></tr>
      <tr><td style="padding:4px 8px;color:#64748b">Hata</td><td style="padding:4px 8px;font-family:monospace">${detay}</td></tr>
    </table>
    <p style="margin-top:12px"><a href="https://fly.io/apps/parktrack-ocr/monitoring">Fly monitoring</a> · <code>flyctl machine list --app parktrack-ocr</code></p>
    <p style="color:#94a3b8;font-size:12px">Bu, saatlik otomatik OCR sağlık kontrolünden gönderildi.</p>
  </div>`;

  const r = await sendMail({ to: alertEmail, subject, html, text });
  // eslint-disable-next-line no-console
  console.log('[ocrSaglik] alarm maili:', r.ok ? (r.mock ? 'mock' : 'gönderildi') : `HATA ${r.error}`);
  return { ok: false, alerted: r.ok, health: h };
}

if (require.main === module) {
  runOcrSaglik()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[ocrSaglik] fatal:', err);
      process.exit(1);
    });
}

module.exports = { runOcrSaglik };
