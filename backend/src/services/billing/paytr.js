/**
 * PayTR billing adapter (Faz Ü3.6).
 *
 * PayTR'ın resmi Node SDK'sı yok — axios ile form-encoded REST.
 * Saklı kart + tekrarlı ödeme akışı:
 *
 *   1. createSubscription → iframe-recurring token al
 *      Kullanıcı `https://www.paytr.com/odeme/guvenli/<token>` iframe'inde
 *      kart bilgisini girer + ilk ödeme alınır + kart saklanır.
 *      Sub status 'pending' → notification webhook 'ok' geldiğinde 'active'.
 *
 *   2. chargeRecurring → /odeme/api/recurring-charge
 *      Saklı kart ile yeni dönem tahsilatı. Senkron success/failed döner.
 *      subscriptionLifecycle cron'undan çağrılır.
 *
 *   3. cancelSubscription → /odeme/api/recurring-stop
 *      PayTR tarafında tekrar tahsilatı durdurur; biz DB'de cancel'ı
 *      atPeriodEnd ile yönetiriz.
 *
 *   4. verifyWebhook (notification URL) — form-encoded body, hash field:
 *      hash = base64(hmac_sha256(merchant_oid + merchant_salt + status +
 *      total_amount, merchant_key))
 *      Spec: https://dev.paytr.com (iframe-recurring sayfası)
 *
 * Env var sözleşmesi:
 *   PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT
 *   PAYTR_TEST_MODE (1=test, 0=production; default 1)
 *   PAYTR_BASE_URL (default https://www.paytr.com)
 *
 * NOT: PayTR docs'undaki exact endpoint isimleri ve gerekli parametreler
 * production deploy öncesi PayTR teknik destek ile doğrulanmalı —
 * MVP iskeleti bilinen spec'e dayanıyor ama test/sandbox response'larıyla
 * gerçekte test edilmedi.
 */
const crypto = require('crypto');
const axios = require('axios');

const DEFAULT_BASE_URL = 'https://www.paytr.com';

function getConfig() {
  const merchantId = process.env.PAYTR_MERCHANT_ID;
  const merchantKey = process.env.PAYTR_MERCHANT_KEY;
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
  if (!merchantId || !merchantKey || !merchantSalt) {
    throw new Error('paytr: PAYTR_MERCHANT_ID, _KEY, _SALT env var\'ları gerekli.');
  }
  return {
    merchantId,
    merchantKey,
    merchantSalt,
    testMode: process.env.PAYTR_TEST_MODE ?? '1',
    baseUrl: process.env.PAYTR_BASE_URL || DEFAULT_BASE_URL,
  };
}

let _http = null;
function getHttp() {
  if (_http) return _http;
  _http = axios.create({
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return _http;
}
function __setHttp(client) { _http = client; }
function __resetHttp() { _http = null; }

/**
 * URL-encoded form body üretir — axios POST'a verilir.
 */
function toForm(obj) {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v != null) params.append(k, String(v));
  });
  return params.toString();
}

function base64HmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

function timingSafeEqStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Period uzunluğunu PayTR recurring interval'larına çevir.
 * monthly → 1 ay, yearly → 12 ay. PayTR API'sinde ay olarak `recurring_payment_interval`.
 */
function cycleInterval(cycle) {
  if (cycle === 'monthly') return { unit: 'M', value: 1 };
  if (cycle === 'yearly') return { unit: 'M', value: 12 };
  throw new Error(`paytr: bilinmeyen cycle ${cycle}`);
}

async function createSubscription({ site, plan, cycle, customer, returnUrl }) {
  const cfg = getConfig();
  const merchantOid = `pt_${site.id}_${Date.now()}`;
  const interval = cycleInterval(cycle);

  // payment_amount: kuruş (PayTR kuruş cinsinden bekler — TL × 100)
  const { getBaseAmount, calculateTotal } = require('../../utils/pricing');
  const base = getBaseAmount(plan, cycle);
  if (base == null || base <= 0) {
    throw new Error(`paytr: '${plan}/${cycle}' için ücretli plan değil.`);
  }
  const totals = calculateTotal(base);
  const paymentAmount = totals.amount_incl_tax;

  // PayTR iframe-recurring hash:
  //   hash = base64(hmac_sha256(
  //     merchant_id + user_ip + merchant_oid + email + payment_amount +
  //     payment_type + installment_count + currency + test_mode + non_3d +
  //     merchant_salt, merchant_key))
  const userIp = customer?.ip || '127.0.0.1';
  const email = customer?.email || `site${site.id}@parktrack.local`;
  const currency = 'TL';
  const installment = '0';
  const testMode = cfg.testMode;
  const non3d = '0';
  const paymentType = 'card';

  const hashStr =
    cfg.merchantId + userIp + merchantOid + email + paymentAmount +
    paymentType + installment + currency + testMode + non3d + cfg.merchantSalt;
  const paytrToken = base64HmacSha256(cfg.merchantKey, hashStr);

  const userBasket = Buffer.from(JSON.stringify([
    [`ParkTrack ${plan} (${cycle})`, (paymentAmount / 100).toFixed(2), 1],
  ])).toString('base64');

  const body = toForm({
    merchant_id: cfg.merchantId,
    user_ip: userIp,
    merchant_oid: merchantOid,
    email,
    payment_amount: paymentAmount,
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: testMode,
    no_installment: 1,
    max_installment: 0,
    user_name: customer?.kullanici_adi || site.ad || 'Site Yoneticisi',
    user_address: site.ad || 'Site',
    user_phone: customer?.gsm || '+905555555555',
    merchant_ok_url: `${returnUrl}/abonelik?paytr=ok`,
    merchant_fail_url: `${returnUrl}/abonelik?paytr=fail`,
    timeout_limit: 30,
    currency,
    test_mode: testMode,
    non_3d: non3d,
    lang: 'tr',
    // Recurring parametreleri:
    recurring_payment: 1,
    recurring_payment_amount: paymentAmount,
    recurring_payment_interval: interval.value, // ay
    recurring_payment_number_of_payments: 0,    // 0 = sınırsız (cancel'a kadar)
  });

  const http = getHttp();
  const resp = await http.post(`${cfg.baseUrl}/odeme/api/get-token`, body);
  const data = resp.data || {};
  if (data.status !== 'success') {
    const err = new Error(`paytr token alınamadı: ${data.reason || 'unknown'}`);
    err.paytr = { reason: data.reason, raw: data };
    throw err;
  }

  return {
    provider_subscription_id: merchantOid, // Webhook callback'inde aynı oid gelir
    checkout_url: `${cfg.baseUrl}/odeme/guvenli/${data.token}`,
    status: 'pending',
  };
}

async function chargeRecurring({ subscription, invoice }) {
  // PayTR /odeme/api/recurring-charge — saklı kart ile yeni tahsilat.
  // Hash: base64(hmac_sha256(merchant_id + merchant_oid + payment_amount + merchant_salt, merchant_key))
  const cfg = getConfig();
  const oid = subscription.provider_subscription_id;
  const amount = invoice.amount_incl_tax;

  const hashStr = cfg.merchantId + oid + amount + cfg.merchantSalt;
  const paytrToken = base64HmacSha256(cfg.merchantKey, hashStr);

  const body = toForm({
    merchant_id: cfg.merchantId,
    merchant_oid: oid,
    payment_amount: amount,
    paytr_token: paytrToken,
    test_mode: cfg.testMode,
  });

  try {
    const http = getHttp();
    const resp = await http.post(`${cfg.baseUrl}/odeme/api/recurring-charge`, body);
    const data = resp.data || {};
    if (data.status === 'success') {
      return {
        provider_payment_id: data.payment_id || `paytr_pay_${Date.now()}`,
        status: 'success',
        raw: data,
      };
    }
    return {
      provider_payment_id: data.payment_id || `paytr_fail_${Date.now()}`,
      status: 'failed',
      error_message: data.err_msg || data.reason || 'paytr_recurring_failed',
      raw: data,
    };
  } catch (err) {
    return {
      provider_payment_id: `paytr_err_${Date.now()}`,
      status: 'failed',
      error_message: err.message,
      raw: { error: err.message },
    };
  }
}

async function cancelSubscription({ subscription, atPeriodEnd }) {
  const cfg = getConfig();
  const oid = subscription.provider_subscription_id;
  const hashStr = cfg.merchantId + oid + cfg.merchantSalt;
  const paytrToken = base64HmacSha256(cfg.merchantKey, hashStr);

  const body = toForm({
    merchant_id: cfg.merchantId,
    merchant_oid: oid,
    paytr_token: paytrToken,
  });

  try {
    const http = getHttp();
    await http.post(`${cfg.baseUrl}/odeme/api/recurring-stop`, body);
  } catch (err) {
    // PayTR sub bulunamazsa veya zaten cancel ise loglayıp devam et.
    // eslint-disable-next-line no-console
    console.warn('paytr recurring-stop hata (devam):', err.message);
  }
  return { status: atPeriodEnd ? 'pending_cancellation' : 'cancelled' };
}

/**
 * PayTR notification callback verify (form-encoded body, hash field).
 *
 * Spec: hash = base64(hmac_sha256(
 *   merchant_oid + merchant_salt + status + total_amount, merchant_key))
 *
 * Notification body fields:
 *   merchant_oid, status ('success'|'failed'), total_amount,
 *   payment_amount, payment_type, currency, merchant_id, test_mode,
 *   payment_id, hash, failed_reason_code, failed_reason_msg
 */
function verifyWebhook(headers, rawBody) {
  const merchantKey = process.env.PAYTR_MERCHANT_KEY;
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
  if (!merchantKey || !merchantSalt) {
    return { ok: false, error: 'paytr_secrets_missing' };
  }

  const bodyStr = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : (typeof rawBody === 'string' ? rawBody : '');

  let params;
  try {
    params = Object.fromEntries(new URLSearchParams(bodyStr));
  } catch {
    return { ok: false, error: 'body_parse_failed' };
  }

  const { merchant_oid, status, total_amount, hash, payment_id } = params;
  if (!merchant_oid || !status || !total_amount || !hash) {
    return { ok: false, error: 'required_fields_missing' };
  }

  const expectedStr = merchant_oid + merchantSalt + status + total_amount;
  const expected = base64HmacSha256(merchantKey, expectedStr);
  if (!timingSafeEqStr(hash, expected)) {
    return { ok: false, error: 'signature_mismatch' };
  }

  // PayTR'da sadece success/failed sub-aktivasyon ve recurring tahsilat
  // event'leri ayrı değil — aynı endpoint hem ilk ödeme hem recurring için
  // gelir. merchant_oid'i karşılaştırarak ilk mi recurring mi ayırt
  // ediyoruz; bu route handler'ın işi (sub status='pending' ise activated,
  // 'active' ise recurring).
  return {
    ok: true,
    event_type: status === 'success' ? 'paytr.payment.success' : 'paytr.payment.failure',
    provider_subscription_id: merchant_oid,
    provider_payment_id: payment_id || null,
    status: status === 'success' ? 'success' : 'failed',
    raw: params,
  };
}

module.exports = {
  name: 'paytr',
  createSubscription,
  chargeRecurring,
  cancelSubscription,
  verifyWebhook,
  __setHttp,
  __resetHttp,
};
