/**
 * Billing provider webhook endpoint'leri (Faz Ü3.5).
 *
 * iyzico (ve sonra paytr) async event'leri buraya düşer:
 *   - subscription.activated   — kullanıcı checkout'u tamamladı → sub aktif
 *   - subscription.cancelled   — provider tarafında iptal edildi
 *   - payment.success          — recurring tahsil başarılı → invoice paid
 *   - payment.failure          — recurring tahsil fail → past_due
 *
 * KRİTİK: signature verify olmadan hiçbir DB değişikliği yapılmaz. Body
 * raw alınır (express.raw) — JSON parse signature verify sonrası yapılır.
 * Rate limit dışında tutulur ki provider retry'ları engellenmesin.
 */
const express = require('express');
const db = require('../db');
const { getProvider } = require('../services/billing');

const router = express.Router();

/**
 * Webhook handler factory — provider bazlı dispatch. Body raw Buffer
 * olarak gelir (üst seviyede express.raw mount edilir).
 */
function makeHandler(providerName) {
  return async function handle(req, res) {
    const adapter = getProvider(providerName);
    const verify = adapter.verifyWebhook(req.headers, req.body);
    if (!verify.ok) {
      // 200 dönmüyoruz — provider retry yapsın diye 401. Ancak log'a
      // sadece short message yazıyoruz; raw body'i loglamıyoruz (PII risk).
      // eslint-disable-next-line no-console
      console.warn(`[webhook:${providerName}] signature verify fail:`, verify.error);
      return res.status(401).json({ ok: false, error: verify.error || 'signature_invalid' });
    }

    try {
      await dispatchEvent(providerName, verify);
      res.json({ ok: true });
    } catch (err) {
      // 500 dön — provider retry edecek. Idempotency için provider_payment_id
      // UNIQUE constraint payment_attempts'te var (Ü3.2 migration).
      // eslint-disable-next-line no-console
      console.error(`[webhook:${providerName}] handler error:`, err.message);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  };
}

async function dispatchEvent(providerName, evt) {
  const { event_type, provider_subscription_id, provider_payment_id, status, raw } = evt;

  // Sub'ı bulurken hem provider sub id hem token (createSubscription'da
  // token kaydedildi; activated event'i gelene kadar gerçek subRefCode yok).
  const sub = provider_subscription_id
    ? await db('subscriptions')
        .where({ provider: providerName, provider_subscription_id })
        .first()
    : null;

  // 1) Subscription aktive edildi (checkout tamamlandı)
  if (event_type === 'subscription.activated' || event_type === 'SUBSCRIPTION_ACTIVATED') {
    if (!sub) return; // henüz DB'de yoksa idempotent sessizce geç
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'active',
      grace_period_ends_at: null,
      updated_at: db.fn.now(),
    });
    return;
  }

  // 2) Recurring payment success
  if (event_type === 'payment.success' || event_type === 'PAYMENT_SUCCESS' || status === 'success') {
    if (!sub) return;
    // En son pending invoice'i paid yap
    const inv = await db('invoices')
      .where({ subscription_id: sub.id, status: 'pending' })
      .orderBy('issued_at', 'desc')
      .first();
    if (inv) {
      await db('invoices').where({ id: inv.id }).update({
        status: 'paid',
        paid_at: db.fn.now(),
      });
      // payment_attempts kaydı — provider_payment_id UNIQUE, duplicate webhook'ta
      // ON CONFLICT yerine try/catch ile geçiyoruz.
      try {
        await db('payment_attempts').insert({
          invoice_id: inv.id,
          provider: providerName,
          provider_payment_id: provider_payment_id || `wh_${Date.now()}`,
          status: 'success',
          amount: inv.amount_incl_tax,
          attempt_no: 1,
          raw_response: raw ? JSON.stringify(raw) : null,
        });
      } catch (e) {
        if (!/unique|duplicate/i.test(e.message)) throw e;
      }
    }
    // Sub past_due ise active'e döndür
    if (sub.status === 'past_due') {
      await db('subscriptions').where({ id: sub.id }).update({
        status: 'active',
        grace_period_ends_at: null,
        updated_at: db.fn.now(),
      });
    }
    return;
  }

  // 3) Recurring payment failure → past_due (cron'da grace period ilerletir)
  if (event_type === 'payment.failure' || event_type === 'PAYMENT_FAILURE' || status === 'failed') {
    if (!sub) return;
    const grace = new Date();
    grace.setDate(grace.getDate() + 7);
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'past_due',
      grace_period_ends_at: grace,
      updated_at: db.fn.now(),
    });
    const inv = await db('invoices')
      .where({ subscription_id: sub.id, status: 'pending' })
      .orderBy('issued_at', 'desc')
      .first();
    if (inv) {
      try {
        await db('payment_attempts').insert({
          invoice_id: inv.id,
          provider: providerName,
          provider_payment_id: provider_payment_id || `wh_fail_${Date.now()}`,
          status: 'failed',
          amount: inv.amount_incl_tax,
          attempt_no: 1,
          error_message: 'webhook reported failure',
          raw_response: raw ? JSON.stringify(raw) : null,
        });
      } catch (e) {
        if (!/unique|duplicate/i.test(e.message)) throw e;
      }
    }
    return;
  }

  // 4) Cancellation event
  if (event_type === 'subscription.cancelled' || event_type === 'SUBSCRIPTION_CANCELLED') {
    if (!sub) return;
    await db('subscriptions').where({ id: sub.id }).update({
      status: 'cancelled',
      updated_at: db.fn.now(),
    });
    // sites.plan'ı baslangic'a düşür (subscriptionLifecycle ile aynı davranış)
    await db('sites').where({ id: sub.site_id }).update({ plan: 'baslangic' });
  }
}

router.post('/iyzico', makeHandler('iyzico'));

module.exports = router;
