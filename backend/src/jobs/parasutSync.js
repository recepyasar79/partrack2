/**
 * Paraşüt e-fatura senkronizasyon cron'u (Faz Ü3.7).
 *
 * Günlük çalışır. status='paid' AND parasut_invoice_id IS NULL olan
 * invoice'leri yakalar — webhook fire-and-forget kaçıranlar, API down
 * yüzünden bekleyenler, ya da gelecekte manuel paid yapılan invoice'ler.
 *
 * Idempotent: zaten parasut_invoice_id dolu olanlar issueInvoice
 * helper'ında atlanır.
 *
 * Hata politikası: bireysel invoice fail'i loglanır, batch devam eder.
 * Toplu fail varsa Sentry'ye düşer (process exit'te).
 */
const db = require('../db');
const parasut = require('../services/parasut');

const BATCH_LIMIT = 100;

async function syncPendingInvoices({ limit = BATCH_LIMIT } = {}) {
  if (!parasut.isConfigured()) {
    return { skipped: true, reason: 'parasut_not_configured', count: 0 };
  }
  const pending = await db('invoices')
    .where({ status: 'paid' })
    .whereNull('parasut_invoice_id')
    .orderBy('issued_at', 'asc')
    .limit(limit);

  let issued = 0;
  let failed = 0;
  for (const inv of pending) {
    try {
      const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
      if (result.issued) issued += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn(`[parasutSync] invoice ${inv.id} fail:`, err.message);
    }
  }
  return { total: pending.length, issued, failed };
}

if (require.main === module) {
  (async () => {
    try {
      const result = await syncPendingInvoices();
      // eslint-disable-next-line no-console
      console.log('[parasutSync]', result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[parasutSync] fatal:', err);
      process.exit(1);
    } finally {
      await db.destroy();
    }
  })();
}

module.exports = { syncPendingInvoices };
