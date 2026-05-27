/**
 * KVKK data retention cron (Faz Ü4).
 *
 * Hassas/uzun-ömürlü tabloları yaş limitlerine göre temizler.
 *
 * Saklama süreleri (env override edilebilir, default 5 yıl):
 *   ihlaller         — ihlal geçmişi (RETENTION_YEARS_VIOLATIONS)
 *   bildirimler      — WhatsApp gönderim logları (RETENTION_YEARS_NOTIFICATIONS)
 *   audit_log        — kim ne yaptı izi (RETENTION_YEARS_AUDIT)
 *   daire_sahip_tarihce — eski sahipler (RETENTION_YEARS_OWNERHISTORY)
 *
 * Foto temizleme ayrı cron'da (jobs/fotoTemizle.js) — 90 gün retention.
 *
 * Idempotent: her çağrı eski kayıtları siler, bir daha bulamaz.
 */
const db = require('../db');

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

function envYears(name, def = 5) {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function cutoffDate(years) {
  return new Date(Date.now() - years * YEAR_MS);
}

/**
 * Tek bir tablo + kolon için temizlik. Sayı döner.
 */
async function purge(table, dateColumn, cutoff) {
  return db(table).where(dateColumn, '<', cutoff).delete();
}

async function runRetention() {
  const result = {};

  const violationCutoff = cutoffDate(envYears('RETENTION_YEARS_VIOLATIONS'));
  result.ihlaller = await purge('ihlaller', 'olusturma_zamani', violationCutoff);

  const notifCutoff = cutoffDate(envYears('RETENTION_YEARS_NOTIFICATIONS'));
  // bildirimler tablosunda 'gonderim_zamani' var; null olabilir (beklemede),
  // o yüzden created_at fallback olarak 'olusturma_zamani' deneyelim. Eğer
  // o da yoksa Knex hata atacak — şema gerçeği migration'a göre.
  // bildirimler.olusturma_zamani CLAUDE.md plan'da var (Faz 2 migration).
  result.bildirimler = await purge('bildirimler', 'olusturma_zamani', notifCutoff);

  const auditCutoff = cutoffDate(envYears('RETENTION_YEARS_AUDIT'));
  result.audit_log = await purge('audit_log', 'zaman', auditCutoff);

  const historyCutoff = cutoffDate(envYears('RETENTION_YEARS_OWNERHISTORY'));
  result.daire_sahip_tarihce = await purge(
    'daire_sahip_tarihce', 'olusturma_zamani', historyCutoff
  );

  return result;
}

if (require.main === module) {
  (async () => {
    try {
      const r = await runRetention();
      // eslint-disable-next-line no-console
      console.log('[dataRetention]', r);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dataRetention] fatal:', err);
      process.exit(1);
    } finally {
      await db.destroy();
    }
  })();
}

module.exports = { runRetention, cutoffDate };
