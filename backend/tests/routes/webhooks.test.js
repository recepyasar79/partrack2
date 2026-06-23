/**
 * Webhook endpoint testleri (Faz Ü3.5).
 *
 * iyzico provider üzerinden gerçek HMAC signature ile tam akış:
 *   - subscription.activated → DB sub status='active'
 *   - payment.success → invoice paid + payment_attempts insert
 *   - payment.failure → sub past_due + grace_period_ends_at set
 *   - signature mismatch → 401, DB değişmez
 *   - duplicate webhook (aynı provider_payment_id) → idempotent
 */
const crypto = require('crypto');

const TEST_SECRET = 'webhook_test_secret_99';
process.env.IYZICO_API_KEY = 'k';
process.env.IYZICO_SECRET_KEY = TEST_SECRET;
process.env.IYZICO_BASE_URL = 'https://sandbox-api.iyzipay.com';
process.env.PAYTR_MERCHANT_ID = '999999';
process.env.PAYTR_MERCHANT_KEY = 'paytr_test_key';
process.env.PAYTR_MERCHANT_SALT = 'paytr_test_salt';

const { app, request, db, cleanupTables } = require('../helpers');

function sign(body) {
  return crypto.createHmac('sha256', TEST_SECRET).update(body).digest('base64');
}

async function seedActiveSub({ status = 'active', refCode = 'iyz_sub_test' } = {}) {
  const periodStart = new Date();
  const periodEnd = new Date(Date.now() + 30 * 86400 * 1000);
  const [sub] = await db('subscriptions').insert({
    site_id: 1,
    plan: 'standart',
    billing_cycle: 'monthly',
    status,
    provider: 'iyzico',
    provider_subscription_id: refCode,
    current_period_start: periodStart,
    current_period_end: periodEnd,
  }).returning('*');
  const [inv] = await db('invoices').insert({
    site_id: 1,
    subscription_id: sub.id,
    invoice_no: `2026-05-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    amount_excl_tax: 29900,
    tax_rate: 20,
    amount_incl_tax: 35880,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'pending',
  }).returning('*');
  return { sub, inv };
}

beforeEach(async () => {
  await cleanupTables();
  await db('payment_attempts').del();
  await db('invoices').del();
  await db('subscriptions').del();
  await db('sites').where({ id: 1 }).update({ plan: 'standart' });
});

afterAll(async () => {
  await db('payment_attempts').del();
  await db('invoices').del();
  await db('subscriptions').del();
  await db.destroy();
});

describe('POST /api/webhooks/iyzico', () => {
  test('subscription.activated → sub status active olur', async () => {
    const { sub } = await seedActiveSub({ status: 'past_due', refCode: 'iyz_act_1' });
    const body = JSON.stringify({
      eventType: 'subscription.activated',
      subscriptionReferenceCode: 'iyz_act_1',
    });
    const r = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    const updated = await db('subscriptions').where({ id: sub.id }).first();
    expect(updated.status).toBe('active');
    expect(updated.grace_period_ends_at).toBeNull();
  });

  test('subscription.activated → sites.plan yükselir (ödeme öncesi açılmamıştı)', async () => {
    await db('sites').where({ id: 1 }).update({ plan: 'baslangic' });
    await seedActiveSub({ status: 'past_due', refCode: 'iyz_plan_up' });
    const body = JSON.stringify({
      eventType: 'subscription.activated',
      subscriptionReferenceCode: 'iyz_plan_up',
    });
    await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    const site = await db('sites').where({ id: 1 }).first();
    expect(site.plan).toBe('standart');
  });

  test('past_due→active payment.success → sites.plan yükselir', async () => {
    await db('sites').where({ id: 1 }).update({ plan: 'baslangic' });
    await seedActiveSub({ status: 'past_due', refCode: 'iyz_plan_pay' });
    const body = JSON.stringify({
      eventType: 'payment.success',
      subscriptionReferenceCode: 'iyz_plan_pay',
      paymentId: 'iyz_plan_pay_1',
      paymentStatus: 'SUCCESS',
    });
    await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    const site = await db('sites').where({ id: 1 }).first();
    expect(site.plan).toBe('standart');
  });

  test('payment.success → invoice paid + payment_attempts insert', async () => {
    const { sub, inv } = await seedActiveSub({ refCode: 'iyz_pay_1' });
    const body = JSON.stringify({
      eventType: 'payment.success',
      subscriptionReferenceCode: 'iyz_pay_1',
      paymentId: 'iyz_payment_88',
      paymentStatus: 'SUCCESS',
    });
    const r = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    const updatedInv = await db('invoices').where({ id: inv.id }).first();
    expect(updatedInv.status).toBe('paid');
    expect(updatedInv.paid_at).toBeTruthy();
    const att = await db('payment_attempts').where({ invoice_id: inv.id }).first();
    expect(att.status).toBe('success');
    expect(att.provider_payment_id).toBe('iyz_payment_88');
    // sub değişmedi (zaten active)
    const updatedSub = await db('subscriptions').where({ id: sub.id }).first();
    expect(updatedSub.status).toBe('active');
  });

  test('past_due sub + payment.success → active olur', async () => {
    const { sub } = await seedActiveSub({ status: 'past_due', refCode: 'iyz_recover' });
    const body = JSON.stringify({
      eventType: 'payment.success',
      subscriptionReferenceCode: 'iyz_recover',
      paymentId: 'iyz_payment_recover',
      paymentStatus: 'SUCCESS',
    });
    await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    const updated = await db('subscriptions').where({ id: sub.id }).first();
    expect(updated.status).toBe('active');
  });

  test('payment.failure → sub past_due + grace period set', async () => {
    const { sub, inv } = await seedActiveSub({ refCode: 'iyz_fail_1' });
    const body = JSON.stringify({
      eventType: 'payment.failure',
      subscriptionReferenceCode: 'iyz_fail_1',
      paymentId: 'iyz_payment_failed',
      paymentStatus: 'FAILURE',
    });
    const r = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    expect(r.status).toBe(200);
    const updated = await db('subscriptions').where({ id: sub.id }).first();
    expect(updated.status).toBe('past_due');
    expect(updated.grace_period_ends_at).toBeTruthy();
    const att = await db('payment_attempts').where({ invoice_id: inv.id }).first();
    expect(att.status).toBe('failed');
  });

  test('subscription.cancelled → sub cancelled + sites.plan=baslangic', async () => {
    const { sub } = await seedActiveSub({ refCode: 'iyz_canc' });
    const body = JSON.stringify({
      eventType: 'subscription.cancelled',
      subscriptionReferenceCode: 'iyz_canc',
    });
    await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    const updated = await db('subscriptions').where({ id: sub.id }).first();
    expect(updated.status).toBe('cancelled');
    const site = await db('sites').where({ id: 1 }).first();
    expect(site.plan).toBe('baslangic');
  });

  test('yanlış signature → 401, DB değişmez', async () => {
    const { sub } = await seedActiveSub({ status: 'past_due', refCode: 'iyz_bad' });
    const body = JSON.stringify({
      eventType: 'subscription.activated',
      subscriptionReferenceCode: 'iyz_bad',
    });
    const r = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', 'wrong_signature')
      .send(body);
    expect(r.status).toBe(401);
    const updated = await db('subscriptions').where({ id: sub.id }).first();
    expect(updated.status).toBe('past_due');
  });

  test('bilinmeyen sub ref → 200 (idempotent sessizce geç)', async () => {
    const body = JSON.stringify({
      eventType: 'subscription.activated',
      subscriptionReferenceCode: 'sub_does_not_exist',
    });
    const r = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sign(body))
      .send(body);
    expect(r.status).toBe(200);
  });

  test('duplicate payment_id → idempotent (tek attempt kalır)', async () => {
    const { inv } = await seedActiveSub({ refCode: 'iyz_dup' });
    const body = JSON.stringify({
      eventType: 'payment.success',
      subscriptionReferenceCode: 'iyz_dup',
      paymentId: 'iyz_dup_pay',
      paymentStatus: 'SUCCESS',
    });
    const sig = sign(body);
    await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sig)
      .send(body);
    // 2. çağrı — invoice zaten paid, payment_attempt duplicate
    const r2 = await request(app)
      .post('/api/webhooks/iyzico')
      .set('Content-Type', 'application/json')
      .set('x-iyz-signature-v3', sig)
      .send(body);
    expect(r2.status).toBe(200);
    const attempts = await db('payment_attempts').where({ invoice_id: inv.id });
    expect(attempts.length).toBe(1);
  });
});

// ----------------------------------------------------------------------
// PayTR — form-encoded notification body, response 'OK' text
// ----------------------------------------------------------------------

function paytrSign(merchantOid, status, totalAmount) {
  return crypto
    .createHmac('sha256', 'paytr_test_key')
    .update(merchantOid + 'paytr_test_salt' + status + totalAmount)
    .digest('base64');
}

function paytrBody({ merchant_oid, status, total_amount = '35880', payment_id }) {
  return new URLSearchParams({
    merchant_oid,
    status,
    total_amount,
    hash: paytrSign(merchant_oid, status, total_amount),
    payment_id: payment_id || '',
    merchant_id: '999999',
  }).toString();
}

async function seedPaytrSub({ status = 'past_due', refCode = 'pt_1_seed' } = {}) {
  const periodStart = new Date();
  const periodEnd = new Date(Date.now() + 30 * 86400 * 1000);
  const [sub] = await db('subscriptions').insert({
    site_id: 1,
    plan: 'standart',
    billing_cycle: 'monthly',
    status,
    provider: 'paytr',
    provider_subscription_id: refCode,
    current_period_start: periodStart,
    current_period_end: periodEnd,
  }).returning('*');
  const [inv] = await db('invoices').insert({
    site_id: 1,
    subscription_id: sub.id,
    invoice_no: `2026-05-pt-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    amount_excl_tax: 29900,
    tax_rate: 20,
    amount_incl_tax: 35880,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'pending',
  }).returning('*');
  return { sub, inv };
}

describe('POST /api/webhooks/paytr', () => {
  test('payment.success (ilk aktivasyon, past_due→active) + invoice paid + OK text', async () => {
    const { sub, inv } = await seedPaytrSub({ status: 'past_due', refCode: 'pt_act_1' });
    const body = paytrBody({
      merchant_oid: 'pt_act_1',
      status: 'success',
      payment_id: 'paytr_pay_1',
    });
    const r = await request(app)
      .post('/api/webhooks/paytr')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(body);
    expect(r.status).toBe(200);
    expect(r.text).toBe('OK');
    const updatedSub = await db('subscriptions').where({ id: sub.id }).first();
    expect(updatedSub.status).toBe('active');
    const updatedInv = await db('invoices').where({ id: inv.id }).first();
    expect(updatedInv.status).toBe('paid');
    const att = await db('payment_attempts').where({ invoice_id: inv.id }).first();
    expect(att.status).toBe('success');
    expect(att.provider).toBe('paytr');
  });

  test('payment.failure → past_due + grace period', async () => {
    const { sub, inv } = await seedPaytrSub({ status: 'active', refCode: 'pt_fail_1' });
    const body = paytrBody({
      merchant_oid: 'pt_fail_1',
      status: 'failed',
      payment_id: 'paytr_pay_f1',
    });
    const r = await request(app)
      .post('/api/webhooks/paytr')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(body);
    expect(r.status).toBe(200);
    expect(r.text).toBe('OK');
    const updatedSub = await db('subscriptions').where({ id: sub.id }).first();
    expect(updatedSub.status).toBe('past_due');
    expect(updatedSub.grace_period_ends_at).toBeTruthy();
    const att = await db('payment_attempts').where({ invoice_id: inv.id }).first();
    expect(att.status).toBe('failed');
  });

  test('yanlış hash → 401, DB değişmez', async () => {
    const { sub } = await seedPaytrSub({ status: 'past_due', refCode: 'pt_bad' });
    const body = new URLSearchParams({
      merchant_oid: 'pt_bad',
      status: 'success',
      total_amount: '35880',
      hash: 'WRONG_HASH',
      merchant_id: '999999',
    }).toString();
    const r = await request(app)
      .post('/api/webhooks/paytr')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(body);
    expect(r.status).toBe(401);
    const after = await db('subscriptions').where({ id: sub.id }).first();
    expect(after.status).toBe('past_due');
  });
});
