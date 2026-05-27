/**
 * Billing provider abstract interface (Faz Ü3.2).
 *
 * Tüm ödeme sağlayıcıları aynı sözleşmeye uyar — route'lar provider'a
 * bağımlı kalmadan abonelik akışını yönetir. Test'te `mock` adapter
 * deterministik davranır; production'da iyzico/paytr seçilir.
 *
 * Provider seçimi:
 *   - process.env.BILLING_PROVIDER (development override)
 *   - subscription.provider (kayıtlı abonelik için)
 *   - default: 'mock' (NODE_ENV=test) / 'iyzico' (production)
 *
 * Adapter sözleşmesi (her dosya bu module.exports'u sağlar):
 *
 *   async createSubscription({ site, plan, cycle, customer, returnUrl }) → {
 *     provider_subscription_id: string,
 *     checkout_url: string | null,    // 3D Secure veya iframe URL'i
 *     status: 'active' | 'pending'    // pending = kullanıcı checkout_url'e yönlendirilmeli
 *   }
 *
 *   async cancelSubscription({ subscription, atPeriodEnd }) → {
 *     status: 'cancelled' | 'pending_cancellation'
 *   }
 *
 *   async chargeRecurring({ subscription, invoice }) → {
 *     provider_payment_id: string,
 *     status: 'success' | 'failed',
 *     error_message?: string,
 *     raw: object
 *   }
 *
 *   verifyWebhook(headers, rawBody) → {
 *     ok: boolean,
 *     event_type: string,
 *     provider_payment_id?: string,
 *     status?: 'success' | 'failed',
 *     provider_subscription_id?: string
 *   }
 *
 * Yeni provider eklemek: services/billing/<name>.js dosyası ve aşağıdaki
 * `getProvider`'a kayıt.
 */

const mock = require('./mock');
const iyzico = require('./iyzico');

const REGISTRY = {
  mock,
  iyzico,
  // paytr:  require('./paytr'),   // Ü3.6'da eklenecek
};

/**
 * @param {string} [name] - 'mock' | 'iyzico' | 'paytr'. Yoksa env default'u.
 * @returns adapter
 */
function getProvider(name) {
  const selected = name
    || process.env.BILLING_PROVIDER
    || (process.env.NODE_ENV === 'test' ? 'mock' : 'iyzico');
  const adapter = REGISTRY[selected];
  if (!adapter) {
    throw new Error(`Billing provider bulunamadı: ${selected}`);
  }
  return adapter;
}

module.exports = { getProvider, REGISTRY };
