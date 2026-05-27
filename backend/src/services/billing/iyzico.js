/**
 * iyzico billing adapter (Faz Ü3.5).
 *
 * iyzico Subscription API'sine bağlanır. SDK callback-bazlı; biz hepsini
 * Promise'e sarıyoruz. Plan tanımları (subscriptionProduct + pricingPlan)
 * iyzico panelinde manuel oluşturulup reference code'ları env var'lara
 * yazılır — bu adapter sadece checkout başlatır, charge'ı iyzico otomatik
 * tetikler.
 *
 * Env var sözleşmesi:
 *   IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL
 *   IYZICO_PLAN_STANDART_MONTHLY, IYZICO_PLAN_STANDART_YEARLY
 *   IYZICO_PLAN_PRO_MONTHLY,      IYZICO_PLAN_PRO_YEARLY
 *
 * createSubscription → checkout form initialize → status='pending' +
 *   checkout_url (kullanıcı iyzico hosted ödeme sayfasına yönlendirilir).
 *   Webhook 'subscription.activated' geldiğinde DB'de 'active'e geçer.
 *
 * chargeRecurring → iyzico tarafında otomatik tahsil edilir; bu method
 *   sub'ın iyzico'da gerçekten ACTIVE olup olmadığını doğrular (status check).
 *   Pro-rate ek tahsilat şu an desteklenmiyor (mevcut PATCH /plan flow'unda
 *   ek tahsilat başarısız döner → plan değişmez).
 *
 * verifyWebhook → x-iyz-signature-v3 header'ı HMAC-SHA256(secret, body)
 *   base64 ile doğrulanır. Production'da iyzico panelinden test eventi
 *   yollanarak signature algoritması doğrulanmalı (V1/V2/V3 farklı).
 */
const crypto = require('crypto');
const Iyzipay = require('iyzipay');

let _client = null;

/**
 * Lazy singleton — test'te `__setClient` ile override edilebilir.
 */
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const uri = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
  if (!apiKey || !secretKey) {
    throw new Error('iyzico: IYZICO_API_KEY ve IYZICO_SECRET_KEY env var\'ları gerekli.');
  }
  _client = new Iyzipay({ apiKey, secretKey, uri });
  return _client;
}

function __setClient(client) { _client = client; }
function __resetClient() { _client = null; }

/**
 * Callback API'yi Promise'e sar. iyzico SDK `(req, cb)` pattern'i kullanır;
 * `cb` her zaman 2 arg alır: `(err, result)`. iyzico iş hatası (status:'failure')
 * `result` içinde döner — err null kalır.
 */
function callbackToPromise(invoke) {
  return new Promise((resolve, reject) => {
    invoke((err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

const PLAN_ENV = {
  standart: {
    monthly: 'IYZICO_PLAN_STANDART_MONTHLY',
    yearly: 'IYZICO_PLAN_STANDART_YEARLY',
  },
  pro: {
    monthly: 'IYZICO_PLAN_PRO_MONTHLY',
    yearly: 'IYZICO_PLAN_PRO_YEARLY',
  },
};

function planReferenceCode(plan, cycle) {
  const envKey = PLAN_ENV[plan]?.[cycle];
  if (!envKey) {
    throw new Error(`iyzico: '${plan}/${cycle}' planı için pricing plan tanımı yok.`);
  }
  const code = process.env[envKey];
  if (!code) {
    throw new Error(`iyzico: env var ${envKey} boş — panelden alınmış reference code gerekli.`);
  }
  return code;
}

/**
 * İyzico checkout form, customer için zorunlu alanlar bekler. Gerçek site
 * yöneticisi datası yoksa minimum geçerli placeholder'larla başlatılır;
 * kullanıcı hosted form'da kendi bilgilerini girer.
 */
function buildCustomer(customer, site) {
  const fullname = customer?.kullanici_adi || site?.ad || 'Site Yoneticisi';
  const [name, ...surnameParts] = fullname.trim().split(/\s+/);
  return {
    name: name || 'Site',
    surname: surnameParts.join(' ') || 'Yoneticisi',
    identityNumber: '11111111111',
    email: customer?.email || `site${site.id}@parktrack.local`,
    gsmNumber: customer?.gsm || '+905555555555',
    billingAddress: {
      contactName: fullname,
      city: 'Istanbul',
      country: 'Turkey',
      address: site?.ad || 'Site',
      zipCode: '34000',
    },
    shippingAddress: {
      contactName: fullname,
      city: 'Istanbul',
      country: 'Turkey',
      address: site?.ad || 'Site',
      zipCode: '34000',
    },
  };
}

async function createSubscription({ site, plan, cycle, customer, returnUrl }) {
  const ref = planReferenceCode(plan, cycle);
  const client = getClient();

  const result = await callbackToPromise((cb) =>
    client.subscriptionCheckoutForm.initialize({
      locale: 'tr',
      conversationId: `site_${site.id}_${Date.now()}`,
      pricingPlanReferenceCode: ref,
      subscriptionInitialStatus: 'ACTIVE',
      callbackUrl: `${returnUrl}/abonelik`,
      customer: buildCustomer(customer, site),
    }, cb)
  );

  if (result.status !== 'success') {
    const err = new Error(`iyzico checkout başlatılamadı: ${result.errorMessage || result.errorCode}`);
    err.iyzico = { code: result.errorCode, group: result.errorGroup };
    throw err;
  }

  return {
    // Token webhook'a kadar geçici id. Webhook 'subscription.activated' geldiğinde
    // subscriptionReferenceCode ile değiştirilir (server.js webhook handler).
    provider_subscription_id: result.token,
    checkout_url: result.paymentPageUrl || result.checkoutFormUrl || null,
    status: 'pending',
  };
}

async function chargeRecurring({ subscription }) {
  // iyzico'da recurring otomatik. Burada sadece sub'ın gerçekten ACTIVE
  // olup olmadığını doğruluyoruz — ACTIVE değilse failed dönüyoruz ki
  // mevcut route mantığı (pro-rate ek tahsilat) doğru tepki versin.
  const client = getClient();
  try {
    const result = await callbackToPromise((cb) =>
      client.subscription.retrieve({
        locale: 'tr',
        conversationId: `retrieve_${Date.now()}`,
        subscriptionReferenceCode: subscription.provider_subscription_id,
      }, cb)
    );
    const status = result?.data?.subscriptionStatus || result?.subscriptionStatus;
    if (result.status === 'success' && status === 'ACTIVE') {
      return {
        provider_payment_id: `iyz_active_${Date.now()}`,
        status: 'success',
        raw: { iyzico_status: status },
      };
    }
    return {
      provider_payment_id: `iyz_fail_${Date.now()}`,
      status: 'failed',
      error_message: status || result.errorMessage || 'iyzico_sub_not_active',
      raw: result,
    };
  } catch (err) {
    return {
      provider_payment_id: `iyz_err_${Date.now()}`,
      status: 'failed',
      error_message: err.message,
      raw: { error: err.message },
    };
  }
}

async function cancelSubscription({ subscription, atPeriodEnd }) {
  const client = getClient();
  const result = await callbackToPromise((cb) =>
    client.subscription.cancel({
      locale: 'tr',
      conversationId: `cancel_${Date.now()}`,
      subscriptionReferenceCode: subscription.provider_subscription_id,
    }, cb)
  );
  if (result.status !== 'success') {
    // iyzico zaten cancel olmuşsa veya bulunamazsa loglayıp devam et —
    // bizim DB'de cancel kaydı kalıcı olmalı.
    // eslint-disable-next-line no-console
    console.warn('iyzico subscription.cancel failure (devam ediliyor):', result.errorMessage);
  }
  return { status: atPeriodEnd ? 'pending_cancellation' : 'cancelled' };
}

/**
 * iyzico webhook imza doğrulama. Spec: x-iyz-signature-v3 header'ı,
 * raw body üzerinde HMAC-SHA256 (secretKey) base64 sonucu. Production'da
 * iyzico panelinden test event yollayıp signature uyumu kontrol edilmeli.
 */
function verifyWebhook(headers, rawBody) {
  const secret = process.env.IYZICO_SECRET_KEY;
  if (!secret) return { ok: false, error: 'IYZICO_SECRET_KEY missing' };
  const sig = headers['x-iyz-signature-v3']
    || headers['X-Iyz-Signature-V3']
    || headers['x-iyz-signature-v1'];
  if (!sig) return { ok: false, error: 'signature_missing' };

  const body = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64');
  // sabit-süre karşılaştırma — timing attack engelle
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length
    && crypto.timingSafeEqual(sigBuf, expBuf);
  if (!valid) return { ok: false, error: 'signature_mismatch' };

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return { ok: false, error: 'body_not_json' };
  }

  const subStatus = event.subscriptionStatus || event.data?.subscriptionStatus;
  const payStatus = event.paymentStatus || event.data?.paymentStatus;
  const ok = subStatus === 'ACTIVE' || payStatus === 'SUCCESS' || event.status === 'SUCCESS';

  return {
    ok: true,
    event_type: event.eventType || event.event_type || event.iyziEventType || 'unknown',
    provider_subscription_id:
      event.subscriptionReferenceCode || event.data?.subscriptionReferenceCode || null,
    provider_payment_id:
      event.paymentId || event.iyziPaymentId || event.data?.paymentId || null,
    status: ok ? 'success' : 'failed',
    raw: event,
  };
}

module.exports = {
  name: 'iyzico',
  createSubscription,
  cancelSubscription,
  chargeRecurring,
  verifyWebhook,
  // Test hook'ları
  __setClient,
  __resetClient,
};
