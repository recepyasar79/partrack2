/**
 * Abonelik yaşam döngüsü cron'u (Faz Ü3.4).
 *
 * Günde bir kez çalışır (Fly.io Cron). State machine geçişlerini yönetir:
 *
 *   active + period_end < now + cancel_at_period_end=true  → cancelled
 *   active + period_end < now                              → past_due (charge dene, grace başlat)
 *   past_due + grace_period_ends_at < now                  → suspended
 *   suspended + (now - grace_period_ends_at) > 30 gün      → cancelled
 *
 * past_due'ya geçişte chargeRecurring çağrılır; başarılıysa yeni dönem
 * (active) açılır, başarısızsa grace süresi sayar.
 *
 * İdempotent: aynı gün iki kez çalıştırılırsa hiçbir şey değişmez
 * (state geçiş koşulları durağan).
 */
const db = require('../db');
const { getBaseAmount, calculateTotal, formatInvoiceNo } = require('../utils/pricing');
const { getProvider } = require('../services/billing');

const GRACE_DAYS = 7;
const SUSPEND_TO_CANCEL_DAYS = 30;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

async function nextInvoiceNo() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const row = await db('invoices')
    .where('issued_at', '>=', monthStart.toISOString())
    .count('* as c').first();
  return formatInvoiceNo((parseInt(row.c, 10) || 0) + 1, now);
}

/**
 * Tek subscription için lifecycle adımı işlet.
 * Test çağrılabilir; cron loop bunu her sub için döner.
 */
async function processSubscription(sub, now = new Date()) {
  const periodEnded = new Date(sub.current_period_end) <= now;

  // 1. cancel_at_period_end + dönem bitti → cancelled
  if (sub.cancel_at_period_end && periodEnded && sub.status !== 'cancelled') {
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'cancelled',
      updated_at: db.fn.now(),
    });
    // sites.plan → baslangic (ücretsiz default)
    await db('sites').where({ id: sub.site_id }).update({ plan: 'baslangic' });
    return { action: 'cancelled', reason: 'cancel_at_period_end' };
  }

  // 2. active + dönem bitti → past_due, charge dene, grace başlat
  if (sub.status === 'active' && periodEnded) {
    const provider = getProvider(sub.provider);
    const base = getBaseAmount(sub.plan, sub.billing_cycle);
    const totals = calculateTotal(base);
    const nextPeriodEnd = addCycle(sub.current_period_end, sub.billing_cycle);
    const invoiceNo = await nextInvoiceNo();
    const [invoice] = await db('invoices').insert({
      site_id: sub.site_id,
      subscription_id: sub.id,
      invoice_no: invoiceNo,
      amount_excl_tax: totals.amount_excl_tax,
      tax_rate: totals.tax_rate,
      amount_incl_tax: totals.amount_incl_tax,
      period_start: sub.current_period_end,
      period_end: nextPeriodEnd,
      status: 'pending',
    }).returning('*');

    const charge = await provider.chargeRecurring({ subscription: sub, invoice });
    await db('payment_attempts').insert({
      invoice_id: invoice.id,
      provider: provider.name,
      provider_payment_id: charge.provider_payment_id,
      status: charge.status,
      amount: invoice.amount_incl_tax,
      attempt_no: 1,
      error_message: charge.error_message || null,
      raw_response: charge.raw ? JSON.stringify(charge.raw) : null,
    });

    if (charge.status === 'success') {
      await db('invoices').where({ id: invoice.id }).update({
        status: 'paid', paid_at: db.fn.now(),
      });
      await db('subscriptions').where({ id: sub.id }).update({
        current_period_start: sub.current_period_end,
        current_period_end: nextPeriodEnd,
        status: 'active',
        grace_period_ends_at: null,
        updated_at: db.fn.now(),
      });
      return { action: 'renewed', invoice_id: invoice.id };
    } else {
      const graceEnds = addDays(now, GRACE_DAYS);
      await db('subscriptions').where({ id: sub.id }).update({
        status: 'past_due',
        grace_period_ends_at: graceEnds,
        updated_at: db.fn.now(),
      });
      return { action: 'past_due', grace_ends: graceEnds };
    }
  }

  // 3. past_due + grace bitti → suspended
  if (sub.status === 'past_due'
      && sub.grace_period_ends_at
      && new Date(sub.grace_period_ends_at) <= now) {
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'suspended',
      updated_at: db.fn.now(),
    });
    return { action: 'suspended' };
  }

  // 4. suspended + 30 gün geçti → cancelled
  if (sub.status === 'suspended'
      && sub.grace_period_ends_at
      && (now - new Date(sub.grace_period_ends_at)) > SUSPEND_TO_CANCEL_DAYS * 86400 * 1000) {
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'cancelled',
      updated_at: db.fn.now(),
    });
    await db('sites').where({ id: sub.site_id }).update({ plan: 'baslangic' });
    return { action: 'cancelled', reason: 'suspend_timeout' };
  }

  return { action: 'noop' };
}

async function run() {
  console.log('[subscriptionLifecycle] Başlatıldı');
  const subs = await db('subscriptions').whereNot({ status: 'cancelled' });
  console.log(`[subscriptionLifecycle] ${subs.length} aktif/past_due/suspended subscription`);
  const results = [];
  for (const sub of subs) {
    try {
      const r = await processSubscription(sub);
      if (r.action !== 'noop') {
        results.push({ id: sub.id, plan: sub.plan, ...r });
        console.log(`[subscriptionLifecycle] sub=${sub.id} site=${sub.site_id} → ${r.action}`);
      }
    } catch (err) {
      console.error(`[subscriptionLifecycle] sub=${sub.id} hata:`, err.message);
      results.push({ id: sub.id, error: err.message });
    }
  }
  console.log(`[subscriptionLifecycle] Bitti — ${results.length} değişiklik`);
  return results;
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((e) => {
    console.error('[subscriptionLifecycle] fatal:', e);
    process.exit(1);
  });
}

module.exports = { run, processSubscription, GRACE_DAYS, SUSPEND_TO_CANCEL_DAYS };
