/**
 * OCR sağlık izleme cron'u.
 *
 * Saatte bir çalışır (Fly scheduled machine, `--schedule hourly`). Python OCR
 * servisinin (`parktrack-ocr`) /health'ini sorgular; sağlıksızsa `OCR_ALERT_EMAIL`
 * adresine Resend (SMTP) ile alarm maili atar. OCR makineleri always-on
 * (`auto_stop='off'`) + tek worker (OOM fix 2026-06-15) → normalde hep ayakta;
 * bu job deploy/host-bakım/nadir crash gibi durumları yakalayıp haber verir.
 *
 * Daha ince (5 dk) izleme için harici UptimeRobot önerilir; bu, server-tarafı
 * saatlik yedek alarmdır. DB bağlantısı gerektirmez (sadece HTTP + mail).
 *
 * Env: OCR_ALERT_EMAIL (alıcı; yoksa mail atlanır, durum yine loglanır).
 *      PYTHON_OCR_URL, SMTP_* (mailer).
 */
const { healthCheck } = require('../services/pythonOcr');
const { sendMail, isConfigured } = require('../services/mailer');
const { dayjs, TR_TZ } = require('../utils/timezone');

async function runOcrSaglik() {
  const now = dayjs().tz(TR_TZ).format('YYYY-MM-DD HH:mm');
  const alertEmail = process.env.OCR_ALERT_EMAIL || '';

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
