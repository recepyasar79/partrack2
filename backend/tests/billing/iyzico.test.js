/**
 * iyzico billing adapter unit testleri (Faz Ü3.5).
 *
 * SDK kullanmadan __setClient ile fake client enjekte ediyoruz — gerçek
 * iyzico API'sine istek atmadan adapter sözleşmesini doğruluyoruz.
 */
const crypto = require('crypto');

const TEST_SECRET = 'test_iyzico_secret_42';
process.env.IYZICO_API_KEY = 'test_key';
process.env.IYZICO_SECRET_KEY = TEST_SECRET;
process.env.IYZICO_BASE_URL = 'https://sandbox-api.iyzipay.com';
process.env.IYZICO_PLAN_STANDART_MONTHLY = 'plan_std_m';
process.env.IYZICO_PLAN_STANDART_YEARLY = 'plan_std_y';
process.env.IYZICO_PLAN_PRO_MONTHLY = 'plan_pro_m';
process.env.IYZICO_PLAN_PRO_YEARLY = 'plan_pro_y';

const iyzico = require('../../src/services/billing/iyzico');

function fakeClient(overrides = {}) {
  return {
    subscriptionCheckoutForm: {
      initialize: (req, cb) => cb(null, overrides.initResult || {
        status: 'success',
        token: 'iyz_token_abc',
        paymentPageUrl: 'https://sandbox-api.iyzipay.com/pay/abc',
      }),
    },
    subscription: {
      retrieve: (req, cb) => cb(null, overrides.retrieveResult || {
        status: 'success',
        data: { subscriptionStatus: 'ACTIVE' },
      }),
      cancel: (req, cb) => cb(null, overrides.cancelResult || { status: 'success' }),
    },
  };
}

afterEach(() => iyzico.__resetClient());

describe('iyzico.createSubscription', () => {
  test('checkout form başlatır → pending + checkout_url', async () => {
    iyzico.__setClient(fakeClient());
    const r = await iyzico.createSubscription({
      site: { id: 7, ad: 'Test Sitesi' },
      plan: 'standart',
      cycle: 'monthly',
      customer: { kullanici_adi: 'recep', email: 'r@x.com' },
      returnUrl: 'http://localhost:5173',
    });
    expect(r.status).toBe('pending');
    expect(r.provider_subscription_id).toBe('iyz_token_abc');
    expect(r.checkout_url).toMatch(/^https:\/\//);
  });

  test('iyzico hata dönerse exception fırlatır', async () => {
    iyzico.__setClient(fakeClient({
      initResult: { status: 'failure', errorMessage: 'Invalid pricing plan', errorCode: '1001' },
    }));
    await expect(
      iyzico.createSubscription({
        site: { id: 1 }, plan: 'pro', cycle: 'yearly',
        customer: {}, returnUrl: 'http://x',
      })
    ).rejects.toThrow(/Invalid pricing plan/);
  });

  test('pricing plan env yoksa anlaşılır hata', async () => {
    iyzico.__setClient(fakeClient());
    const orig = process.env.IYZICO_PLAN_PRO_MONTHLY;
    delete process.env.IYZICO_PLAN_PRO_MONTHLY;
    try {
      await expect(
        iyzico.createSubscription({
          site: { id: 1 }, plan: 'pro', cycle: 'monthly',
          customer: {}, returnUrl: 'http://x',
        })
      ).rejects.toThrow(/IYZICO_PLAN_PRO_MONTHLY/);
    } finally {
      process.env.IYZICO_PLAN_PRO_MONTHLY = orig;
    }
  });
});

describe('iyzico.chargeRecurring', () => {
  test('sub ACTIVE → success', async () => {
    iyzico.__setClient(fakeClient());
    const r = await iyzico.chargeRecurring({
      subscription: { provider_subscription_id: 'sub_ref_1' },
    });
    expect(r.status).toBe('success');
  });

  test('sub PENDING → failed', async () => {
    iyzico.__setClient(fakeClient({
      retrieveResult: { status: 'success', data: { subscriptionStatus: 'PENDING' } },
    }));
    const r = await iyzico.chargeRecurring({
      subscription: { provider_subscription_id: 'sub_ref_2' },
    });
    expect(r.status).toBe('failed');
    expect(r.error_message).toBe('PENDING');
  });

  test('SDK exception → failed (route 402 dönsün)', async () => {
    iyzico.__setClient({
      subscription: {
        retrieve: (req, cb) => cb(new Error('Network down')),
      },
    });
    const r = await iyzico.chargeRecurring({
      subscription: { provider_subscription_id: 'sub_ref_3' },
    });
    expect(r.status).toBe('failed');
    expect(r.error_message).toBe('Network down');
  });
});

describe('iyzico.cancelSubscription', () => {
  test('atPeriodEnd true → pending_cancellation', async () => {
    iyzico.__setClient(fakeClient());
    const r = await iyzico.cancelSubscription({
      subscription: { provider_subscription_id: 'sub_ref_1' },
      atPeriodEnd: true,
    });
    expect(r.status).toBe('pending_cancellation');
  });

  test('atPeriodEnd false → cancelled', async () => {
    iyzico.__setClient(fakeClient());
    const r = await iyzico.cancelSubscription({
      subscription: { provider_subscription_id: 'sub_ref_1' },
      atPeriodEnd: false,
    });
    expect(r.status).toBe('cancelled');
  });

  test('iyzico failure response → yine cancelled (DB kaydı kalıcı)', async () => {
    iyzico.__setClient(fakeClient({
      cancelResult: { status: 'failure', errorMessage: 'Sub already cancelled' },
    }));
    const r = await iyzico.cancelSubscription({
      subscription: { provider_subscription_id: 'x' },
      atPeriodEnd: false,
    });
    expect(r.status).toBe('cancelled');
  });
});

describe('iyzico.verifyWebhook', () => {
  function sign(body) {
    return crypto.createHmac('sha256', TEST_SECRET).update(body).digest('base64');
  }

  test('doğru imza → ok=true, event çözülür', () => {
    const body = JSON.stringify({
      eventType: 'subscription.activated',
      subscriptionReferenceCode: 'sub_xyz',
      subscriptionStatus: 'ACTIVE',
    });
    const r = iyzico.verifyWebhook({ 'x-iyz-signature-v3': sign(body) }, body);
    expect(r.ok).toBe(true);
    expect(r.event_type).toBe('subscription.activated');
    expect(r.provider_subscription_id).toBe('sub_xyz');
    expect(r.status).toBe('success');
  });

  test('Buffer body kabul edilir (raw express body)', () => {
    const body = JSON.stringify({ eventType: 'payment.success', paymentStatus: 'SUCCESS' });
    const r = iyzico.verifyWebhook(
      { 'x-iyz-signature-v3': sign(body) },
      Buffer.from(body, 'utf8')
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe('success');
  });

  test('yanlış imza → ok=false', () => {
    const body = JSON.stringify({ eventType: 'x' });
    const r = iyzico.verifyWebhook({ 'x-iyz-signature-v3': 'bogus' }, body);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('signature_mismatch');
  });

  test('signature header eksik → ok=false', () => {
    const r = iyzico.verifyWebhook({}, '{}');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('signature_missing');
  });

  test('payment.failure event_type fail status verir', () => {
    const body = JSON.stringify({
      eventType: 'payment.failure',
      paymentStatus: 'FAILURE',
      subscriptionReferenceCode: 'sub_1',
      paymentId: 'p_99',
    });
    const r = iyzico.verifyWebhook({ 'x-iyz-signature-v3': sign(body) }, body);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('failed');
    expect(r.provider_payment_id).toBe('p_99');
  });
});
