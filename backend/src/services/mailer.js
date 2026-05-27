/**
 * SMTP mail gönderim servisi (Faz Ü7.2).
 *
 * Env var:
 *   SMTP_HOST, SMTP_PORT (default 587)
 *   SMTP_USER, SMTP_PASS — auth (boşsa skip)
 *   SMTP_FROM            — From: header (örn '"ParkTrack" <no-reply@parktrack.io>')
 *   SMTP_SECURE          — '1' veya 'true' → TLS (port 465)
 *
 * Env eksikse `isConfigured()` false döner; sendMail no-op + mock:true.
 * Bu sayede dev/CI ortamında schedule kayıtları test edilebilir ama
 * gerçek mail gitmez.
 *
 * `sendMail({to, subject, html, text})` → `{ok, mock?, error?, info?}`.
 */
const nodemailer = require('nodemailer');

let cachedTransporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true'
    || process.env.SMTP_SECURE === '1'
    || port === 465;
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    } : undefined,
  });
  return cachedTransporter;
}

async function sendMail({ to, subject, html, text }) {
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] SMTP yapılandırılmadı — mail gönderimi atlanıyor.', { to, subject });
    return { ok: true, mock: true };
  }
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    return { ok: true, info };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mailer] send fail:', err.message);
    return { ok: false, error: err.message };
  }
}

// Test'lerden transport cache'ini sıfırlamak için.
function _resetTransporterCache() {
  cachedTransporter = null;
}

module.exports = { isConfigured, sendMail, _resetTransporterCache };
