/**
 * Paraşüt e-fatura entegrasyonu (Faz Ü3.7).
 *
 * Akış:
 *   1. payment.success webhook → invoice paid → issueInvoiceForPaidInvoice
 *      fire-and-forget. Hata olursa Sentry/log + parasut_invoice_id NULL
 *      kalır.
 *   2. Cron job (parasutSync) günde bir çalışıp NULL parasut_invoice_id
 *      olan paid invoice'leri yakalar (webhook miss / API down retry).
 *   3. parasut_invoice_id + pdf_url DB'ye yazıldığında Abonelik UI'da
 *      kullanıcı PDF link'i görür.
 *
 * Paraşüt API'si JSON:API standardı kullanır. OAuth2 password grant —
 * token cache memory'de, 401 alınca refresh.
 *
 * Env vars:
 *   PARASUT_CLIENT_ID, PARASUT_CLIENT_SECRET,
 *   PARASUT_USERNAME, PARASUT_PASSWORD,
 *   PARASUT_COMPANY_ID, PARASUT_API_URL (default https://api.parasut.com)
 *
 * Konfigüre edilmemişse isConfigured() false döner — issueInvoice no-op
 * olur, sistem çalışmaya devam eder (sadece e-fatura kesilmez).
 *
 * NOT: Paraşüt API'sinin exact field isimleri / mandatory parametreler
 * production deploy öncesi Paraşüt API docs ile (https://apidocs.parasut.com)
 * teyit edilmeli — MVP iskeleti bilinen JSON:API standartına dayanır.
 */
const axios = require('axios');
const db = require('../db');

const DEFAULT_API_URL = 'https://api.parasut.com';

function getConfig() {
  return {
    clientId: process.env.PARASUT_CLIENT_ID,
    clientSecret: process.env.PARASUT_CLIENT_SECRET,
    username: process.env.PARASUT_USERNAME,
    password: process.env.PARASUT_PASSWORD,
    companyId: process.env.PARASUT_COMPANY_ID,
    apiUrl: process.env.PARASUT_API_URL || DEFAULT_API_URL,
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.clientId && c.clientSecret && c.username && c.password && c.companyId);
}

// ---- HTTP client + token cache --------------------------------------

let _http = null;
let _tokenCache = null; // { access_token, refresh_token, expiresAt }

function getHttp() {
  if (_http) return _http;
  _http = axios.create({ timeout: 20000 });
  return _http;
}

function __setHttp(client) { _http = client; }
function __resetHttp() { _http = null; _tokenCache = null; }
function __setToken(token) { _tokenCache = token; }

async function fetchToken({ refresh = false } = {}) {
  const cfg = getConfig();
  const body = refresh && _tokenCache?.refresh_token
    ? {
        grant_type: 'refresh_token',
        refresh_token: _tokenCache.refresh_token,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }
    : {
        grant_type: 'password',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        username: cfg.username,
        password: cfg.password,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      };
  const resp = await getHttp().post(`${cfg.apiUrl}/oauth/token`, body);
  const data = resp.data;
  // expires_in saniye; biraz erken refresh için 60s buffer
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  _tokenCache = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt,
  };
  return _tokenCache;
}

async function getValidToken() {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) return _tokenCache;
  // Cache yoksa password grant; refresh_token varsa onu deneme (genelde uzun
  // ömürlü değil; password grant her zaman yedek).
  try {
    if (_tokenCache?.refresh_token) return await fetchToken({ refresh: true });
  } catch {
    // refresh_token süresi geçtiyse password grant ile dene
  }
  return await fetchToken({ refresh: false });
}

/**
 * Authenticated JSON:API request. 401 alınca tokenı sıfırlayıp bir kez
 * daha dener (refresh flow). content-type Paraşüt'ün beklediği gibi
 * vnd.api+json.
 */
async function apiRequest(method, path, { body, query } = {}) {
  const cfg = getConfig();
  const token = await getValidToken();
  const url = `${cfg.apiUrl}/v4/${cfg.companyId}${path}`;
  const options = {
    method,
    url,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
  };
  if (body) options.data = body;
  if (query) options.params = query;

  try {
    const resp = await getHttp().request(options);
    return resp.data;
  } catch (err) {
    if (err.response?.status === 401) {
      // Token expired; bir kez refresh + retry
      _tokenCache = null;
      const newToken = await getValidToken();
      options.headers.Authorization = `Bearer ${newToken.access_token}`;
      const resp = await getHttp().request(options);
      return resp.data;
    }
    throw err;
  }
}

// ---- Domain helpers --------------------------------------------------

/**
 * E-posta ile mevcut contact'ı bul; yoksa oluştur. Aynı site için
 * tekrar tekrar contact yaratmaktan kaçınır.
 */
async function findOrCreateContact({ email, name }) {
  const list = await apiRequest('GET', '/contacts', {
    query: { 'filter[email]': email, page: { size: 1 } },
  });
  if (list?.data?.length > 0) return list.data[0].id;

  const create = await apiRequest('POST', '/contacts', {
    body: {
      data: {
        type: 'contacts',
        attributes: {
          name,
          email,
          contact_type: 'person',
          account_type: 'customer',
        },
      },
    },
  });
  return create.data.id;
}

/**
 * Sales invoice oluştur. Paraşüt'te tutarlar TL (decimal), bizim DB
 * kuruş integer — bölünür.
 */
async function createSalesInvoice({ contactId, invoice, planLabel }) {
  const unitPriceExcl = +(invoice.amount_excl_tax / 100).toFixed(2);
  const issueDate = new Date(invoice.issued_at || Date.now()).toISOString().slice(0, 10);

  const resp = await apiRequest('POST', '/sales_invoices', {
    body: {
      data: {
        type: 'sales_invoices',
        attributes: {
          item_type: 'invoice',
          description: `ParkTrack ${planLabel} abonelik (${invoice.invoice_no})`,
          issue_date: issueDate,
          due_date: issueDate,
          currency: 'TRL',
        },
        relationships: {
          contact: { data: { type: 'contacts', id: contactId } },
          details: { data: [{ type: 'sales_invoice_details', id: '1' }] },
        },
      },
      included: [
        {
          type: 'sales_invoice_details',
          id: '1',
          attributes: {
            quantity: 1.0,
            unit_price: unitPriceExcl,
            vat_rate: invoice.tax_rate, // % (20 gibi)
            discount_type: 'percentage',
            discount_value: 0,
            description: `ParkTrack ${planLabel}`,
          },
        },
      ],
    },
  });
  return resp.data; // { id, attributes, ... }
}

/**
 * E-arşiv fatura onayı — Paraşüt asenkron işler. Response'ta e_archive
 * resource'unun id'si ve status (pending → successful/error). MVP'de
 * direkt download_url alabilirsek alıyoruz; alamazsak parasut_invoice_id
 * yine kayıt edilir, PDF link sonra cron'da güncellenebilir.
 */
async function submitEArchive(salesInvoiceId, email) {
  const resp = await apiRequest('POST', `/sales_invoices/${salesInvoiceId}/e_archives`, {
    body: {
      data: {
        type: 'e_archives',
        attributes: {
          sending_type: email ? 'email' : 'simple',
          to: email,
        },
      },
    },
  });
  return resp.data;
}

// ---- Üst seviye: paid invoice → Paraşüt'e fatura kes ----------------

/**
 * Bir invoice'u Paraşüt'e gönder. DB'den invoice + sub + site'ı çeker,
 * customer find/create, sales invoice, e-archive submit, parasut_invoice_id
 * + pdf_url DB'ye yazar.
 *
 * Idempotent: invoice.parasut_invoice_id zaten doluysa no-op.
 */
async function issueInvoiceForPaidInvoice(invoiceId) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'parasut_not_configured' };
  }

  const inv = await db('invoices').where({ id: invoiceId }).first();
  if (!inv) return { skipped: true, reason: 'invoice_not_found' };
  if (inv.parasut_invoice_id) return { skipped: true, reason: 'already_issued' };
  if (inv.status !== 'paid') {
    return { skipped: true, reason: `invoice_status_${inv.status}` };
  }

  const site = await db('sites').where({ id: inv.site_id }).first();
  if (!site) return { skipped: true, reason: 'site_not_found' };

  // Site_yonetici e-posta'sını al (faturayı kime gönderelim)
  const adminUser = await db('users')
    .where({ site_id: site.id, rol: 'site_yonetici', aktif: true })
    .orderBy('id', 'asc')
    .first();
  const email = adminUser?.email || null;
  const recipientName = site.ad || `Site #${site.id}`;

  const contactId = await findOrCreateContact({
    email: email || `site${site.id}@parktrack.local`,
    name: recipientName,
  });

  const sub = await db('subscriptions').where({ id: inv.subscription_id }).first();
  const planLabel = sub?.plan
    ? `${sub.plan} (${sub.billing_cycle === 'yearly' ? 'yıllık' : 'aylık'})`
    : 'Abonelik';

  const salesInvoice = await createSalesInvoice({ contactId, invoice: inv, planLabel });
  const salesInvoiceId = salesInvoice.id;

  // E-arşiv submit — bazı response'larda direct download_url gelmez,
  // status 'pending' ise pdf_url sonra cron'da doldurulur.
  let pdfUrl = null;
  try {
    const eArchive = await submitEArchive(salesInvoiceId, email);
    pdfUrl = eArchive?.attributes?.download_url
      || eArchive?.attributes?.pdf_url
      || null;
  } catch (err) {
    // E-arşiv submission fail → sales invoice oluşturuldu ama PDF yok.
    // parasut_invoice_id'i yine kaydedip cron'da PDF retry yapılabilir.
    // eslint-disable-next-line no-console
    console.warn('parasut e_archive submit fail (invoice id kayıt edildi):', err.message);
  }

  await db('invoices').where({ id: invoiceId }).update({
    parasut_invoice_id: salesInvoiceId,
    pdf_url: pdfUrl,
    updated_at: db.fn.now(),
  });

  return { issued: true, salesInvoiceId, pdfUrl };
}

module.exports = {
  isConfigured,
  findOrCreateContact,
  createSalesInvoice,
  submitEArchive,
  issueInvoiceForPaidInvoice,
  // Test hook'ları
  __setHttp,
  __resetHttp,
  __setToken,
};
