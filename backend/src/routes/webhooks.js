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
const parasut = require('../services/parasut');

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
      // PayTR notification URL'i text 'OK' bekler (aksi halde retry tetiklenir).
      // Diğer provider'lar JSON kabul ediyor.
      if (providerName === 'paytr') return res.type('text/plain').send('OK');
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
  // Dispatch tamamen event_type üzerinden — verifyWebhook'tan dönen `status`
  // alanı payment context'i için bilgilendiricidir, cancellation event'lerini
  // yanlışlıkla "failed" branch'ine düşürmemek için fallback olarak kullanılmaz.
  const { event_type, provider_subscription_id, provider_payment_id, raw } = evt;

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
    // Ödeme tamamlandı → planı ŞİMDİ yükselt. POST /subscription ödeme
    // 'pending'ken planı yükseltmiyor; gerçek yükseltme bu noktada olur.
    await db('sites').where({ id: sub.site_id }).update({ plan: sub.plan });
    return;
  }

  // 2) Recurring payment success (PayTR ilk aktivasyon + sonraki tahsilatların
  // hepsi 'paytr.payment.success' ile gelir; sub.status'a göre activation vs
  // recurring ayrımı bu branch içinde yapılır)
  if (event_type === 'payment.success' || event_type === 'PAYMENT_SUCCESS'
      || event_type === 'paytr.payment.success') {
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
      // Paraşüt e-fatura — fire-and-forget. Webhook response gecikmesin;
      // başarısızlık durumunda parasutSync cron'u yakalar.
      parasut.issueInvoiceForPaidInvoice(inv.id).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[parasut] invoice ${inv.id} issuance fail:`, err.message);
      });
    }
    // Sub past_due → active recovery; PayTR'da sub başlangıçta 'past_due'
    // (route 'pending' provider response'ını 'past_due'ya çekiyor) — ilk
    // payment success aynı transition'ı tetikler, yani activation gibi davranır.
    if (sub.status === 'past_due') {
      await db('subscriptions').where({ id: sub.id }).update({
        status: 'active',
        grace_period_ends_at: null,
        updated_at: db.fn.now(),
      });
      // İlk aktivasyon (PayTR ilk ödeme past_due'dan gelir) → planı yükselt.
      // POST /subscription pending'de yükseltmediği için gerçek yükseltme burada.
      await db('sites').where({ id: sub.site_id }).update({ plan: sub.plan });
    }
    return;
  }

  // 3) Recurring payment failure → past_due (cron'da grace period ilerletir)
  if (event_type === 'payment.failure' || event_type === 'PAYMENT_FAILURE'
      || event_type === 'paytr.payment.failure') {
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
router.post('/paytr', makeHandler('paytr'));

module.exports = router;
