/**
 * PayTR billing adapter unit testleri (Faz Ü3.6).
 *
 * HTTP'yi __setHttp ile mock'luyoruz — gerçek PayTR API'ye istek atmadan
 * adapter sözleşmesini doğruluyoruz.
 */
const crypto = require('crypto');

process.env.PAYTR_MERCHANT_ID = '999999';
process.env.PAYTR_MERCHANT_KEY = 'merch_key_test';
process.env.PAYTR_MERCHANT_SALT = 'merch_salt_test';
process.env.PAYTR_TEST_MODE = '1';
process.env.PAYTR_BASE_URL = 'https://www.paytr.com';

const paytr = require('../../src/services/billing/paytr');

function fakeHttp(handler) {
  return { post: async (url, body) => handler(url, body) };
}

afterEach(() => paytr.__resetHttp());

describe('paytr.createSubscription', () => {
  test('iframe-recurring token alır → checkout_url + pending', async () => {
    let captured;
    paytr.__setHttp(fakeHttp(async (url, body) => {
      captured = { url, body };
      return { data: { status: 'success', token: 'paytr_iframe_token_123' } };
    }));
    const r = await paytr.createSubscription({
      site: { id: 7, ad: 'Test Site' },
      plan: 'standart',
      cycle: 'monthly',
      customer: { kullanici_adi: 'recep', email: 'r@x.com' },
      returnUrl: 'http://localhost:5173',
    });
    expect(r.status).toBe('pending');
    expect(r.provider_subscription_id).toMatch(/^pt_7_/);
    expect(r.checkout_url).toContain('paytr_iframe_token_123');
    expect(captured.url).toBe('https://www.paytr.com/odeme/api/get-token');
    // Recurring parametreleri body'de
    expect(captured.body).toContain('recurring_payment=1');
    expect(captured.body).toContain('recurring_payment_amount=119880'); // 99900 + %20 KDV
    expect(captured.body).toContain('recurring_payment_interval=1');   // monthly
  });

  test('yıllık plan → recurring_payment_interval=12', async () => {
    let captured;
    paytr.__setHttp(fakeHttp(async (url, body) => {
      captured = body;
      return { data: { status: 'success', token: 'tok' } };
    }));
    await paytr.createSubscription({
      site: { id: 1 }, plan: 'pro', cycle: 'yearly',
      customer: {}, returnUrl: 'http://x',
    });
    expect(captured).toContain('recurring_payment_interval=12');
  });

  test('PayTR failure → exception fırlatır', async () => {
    paytr.__setHttp(fakeHttp(async () => ({
      data: { status: 'failed', reason: 'Hash eslesmedi' },
    })));
    await expect(paytr.createSubscription({
      site: { id: 1 }, plan: 'standart', cycle: 'monthly',
      customer: {}, returnUrl: 'http://x',
    })).rejects.toThrow(/Hash eslesmedi/);
  });

  test('baslangic plan (ücretsiz) → exception', async () => {
    paytr.__setHttp(fakeHttp(async () => ({ data: { status: 'success', token: 't' } })));
    await expect(paytr.createSubscription({
      site: { id: 1 }, plan: 'baslangic', cycle: 'monthly',
      customer: {}, returnUrl: 'http://x',
    })).rejects.toThrow(/ücretli plan değil/);
  });

  test('env eksikse anlaşılır hata', async () => {
    const orig = process.env.PAYTR_MERCHANT_KEY;
    delete process.env.PAYTR_MERCHANT_KEY;
    try {
      await expect(paytr.createSubscription({
        site: { id: 1 }, plan: 'pro', cycle: 'monthly',
        customer: {}, returnUrl: 'http://x',
      })).rejects.toThrow(/PAYTR_MERCHANT_ID/);
    } finally {
      process.env.PAYTR_MERCHANT_KEY = orig;
    }
  });
});

describe('paytr.chargeRecurring', () => {
  test('PayTR success → success + payment_id', async () => {
    paytr.__setHttp(fakeHttp(async () => ({
      data: { status: 'success', payment_id: 'paytr_pid_88' },
    })));
    const r = await paytr.chargeRecurring({
      subscription: { provider_subscription_id: 'pt_1_abc' },
      invoice: { amount_incl_tax: 35880 },
    });
    expect(r.status).toBe('success');
    expect(r.provider_payment_id).toBe('paytr_pid_88');
  });

  test('PayTR failed status → failed + err_msg', async () => {
    paytr.__setHttp(fakeHttp(async () => ({
      data: { status: 'failed', err_msg: 'Insufficient funds' },
    })));
    const r = await paytr.chargeRecurring({
      subscription: { provider_subscription_id: 'pt_1_abc' },
      invoice: { amount_incl_tax: 35880 },
    });
    expect(r.status).toBe('failed');
    expect(r.error_message).toBe('Insufficient funds');
  });

  test('HTTP exception → failed', async () => {
    paytr.__setHttp({ post: async () => { throw new Error('Network down'); } });
    const r = await paytr.chargeRecurring({
      subscription: { provider_subscription_id: 'pt_1_abc' },
      invoice: { amount_incl_tax: 35880 },
    });
    expect(r.status).toBe('failed');
    expect(r.error_message).toBe('Network down');
  });
});

describe('paytr.cancelSubscription', () => {
  test('atPeriodEnd true → pending_cancellation', async () => {
    paytr.__setHttp(fakeHttp(async () => ({ data: { status: 'success' } })));
    const r = await paytr.cancelSubscription({
      subscription: { provider_subscription_id: 'pt_1' },
      atPeriodEnd: true,
    });
    expect(r.status).toBe('pending_cancellation');
  });

  test('PayTR API down → yine cancelled (DB kaydı kalıcı)', async () => {
    paytr.__setHttp({ post: async () => { throw new Error('500'); } });
    const r = await paytr.cancelSubscription({
      subscription: { provider_subscription_id: 'pt_1' },
      atPeriodEnd: false,
    });
    expect(r.status).toBe('cancelled');
  });
});

describe('paytr.verifyWebhook', () => {
  const key = 'merch_key_test';
  const salt = 'merch_salt_test';

  function buildBody({ merchant_oid, status, total_amount, payment_id }) {
    const hashStr = merchant_oid + salt + status + total_amount;
    const hash = crypto.createHmac('sha256', key).update(hashStr).digest('base64');
    const params = new URLSearchParams({
      merchant_oid, status, total_amount, hash,
      payment_id: payment_id || '',
      merchant_id: '999999',
    });
    return params.toString();
  }

  test('doğru hash + status=success → ok + paytr.payment.success', () => {
    const body = buildBody({
      merchant_oid: 'pt_1_xyz',
      status: 'success',
      total_amount: '35880',
      payment_id: 'paytr_99',
    });
    const r = paytr.verifyWebhook({}, body);
    expect(r.ok).toBe(true);
    expect(r.event_type).toBe('paytr.payment.success');
    expect(r.provider_subscription_id).toBe('pt_1_xyz');
    expect(r.provider_payment_id).toBe('paytr_99');
    expect(r.status).toBe('success');
  });

  test('status=failed → paytr.payment.failure', () => {
    const body = buildBody({
      merchant_oid: 'pt_1_xyz',
      status: 'failed',
      total_amount: '35880',
    });
    const r = paytr.verifyWebhook({}, body);
    expect(r.ok).toBe(true);
    expect(r.event_type).toBe('paytr.payment.failure');
    expect(r.status).toBe('failed');
  });

  test('Buffer body kabul edilir', () => {
    const body = buildBody({
      merchant_oid: 'pt_1', status: 'success', total_amount: '100',
    });
    const r = paytr.verifyWebhook({}, Buffer.from(body, 'utf8'));
    expect(r.ok).toBe(true);
  });

  test('yanlış hash → signature_mismatch', () => {
    const params = new URLSearchParams({
      merchant_oid: 'pt_1', status: 'success', total_amount: '100',
      hash: 'BOGUS_HASH', merchant_id: '999999',
    });
    const r = paytr.verifyWebhook({}, params.toString());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('signature_mismatch');
  });

  test('required field eksik → required_fields_missing', () => {
    const params = new URLSearchParams({
      status: 'success', total_amount: '100', hash: 'x',
    });
    const r = paytr.verifyWebhook({}, params.toString());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('required_fields_missing');
  });

  test('env eksikse paytr_secrets_missing', () => {
    const orig = process.env.PAYTR_MERCHANT_KEY;
    delete process.env.PAYTR_MERCHANT_KEY;
    try {
      const r = paytr.verifyWebhook({}, 'x=y');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('paytr_secrets_missing');
    } finally {
      process.env.PAYTR_MERCHANT_KEY = orig;
    }
  });
});
