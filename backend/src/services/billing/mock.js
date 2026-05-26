/**
 * Mock billing adapter (Faz Ü3.2) — deterministik davranır, test ve
 * dev için. NODE_ENV=test veya BILLING_PROVIDER=mock olunca kullanılır.
 *
 * Davranış:
 *   - createSubscription: anında 'active' döner, checkout_url yok.
 *   - chargeRecurring: %100 başarı (test'ler `customer.email` ile
 *     "fail@" prefix kullanarak fail simüle edebilir).
 *   - cancelSubscription: anında 'cancelled' veya 'pending_cancellation'.
 *   - verifyWebhook: hep ok, tip body'den okunur.
 *
 * Gerçek provider'lar Ü3.5 (iyzico) ve Ü3.6 (paytr)'da eklenecek.
 */

let counter = 1000;

function nextId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

async function createSubscription({ plan, cycle, customer }) {
  // Test "fail@" e-postası → pending döner, checkout için yönlendirme simüle
  if (customer?.email?.startsWith('fail@')) {
    return {
      provider_subscription_id: nextId('mocksub_pending'),
      checkout_url: 'https://mock-checkout.example/fail',
      status: 'pending',
    };
  }
  return {
    provider_subscription_id: nextId('mocksub'),
    checkout_url: null,
    status: 'active',
  };
}

async function cancelSubscription({ atPeriodEnd }) {
  return { status: atPeriodEnd ? 'pending_cancellation' : 'cancelled' };
}

async function chargeRecurring({ invoice, subscription }) {
  // E-posta veya plan ile fail simulation
  if (subscription?.provider_subscription_id?.includes('pending')) {
    return {
      provider_payment_id: nextId('mockfail'),
      status: 'failed',
      error_message: 'Mock fail (provider_subscription_id pending)',
      raw: { mocked: true },
    };
  }
  return {
    provider_payment_id: nextId('mockpay'),
    status: 'success',
    raw: { mocked: true, invoice_id: invoice?.id },
  };
}

function verifyWebhook(_headers, rawBody) {
  // Test'lerde body düz JSON; production'da provider imzası kontrolü olur
  try {
    const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    return {
      ok: true,
      event_type: event.event_type || 'payment.success',
      provider_payment_id: event.provider_payment_id,
      provider_subscription_id: event.provider_subscription_id,
      status: event.status || 'success',
    };
  } catch {
    return { ok: false };
  }
}

module.exports = {
  name: 'mock',
  createSubscription,
  cancelSubscription,
  chargeRecurring,
  verifyWebhook,
};
