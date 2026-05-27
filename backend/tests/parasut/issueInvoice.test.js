/**
 * Paraşüt issueInvoiceForPaidInvoice DB integration testleri (Faz Ü3.7).
 *
 * DB gerektirir (CI'da koşar). Unit testler tests/parasut/parasut.test.js'te.
 */
process.env.PARASUT_CLIENT_ID = 'cli_test';
process.env.PARASUT_CLIENT_SECRET = 'sec_test';
process.env.PARASUT_USERNAME = 'user@x.com';
process.env.PARASUT_PASSWORD = 'pw_test';
process.env.PARASUT_COMPANY_ID = '12345';

const parasut = require('../../src/services/parasut');
const { db, cleanupTables, createTestUser } = require('../helpers');

function makeFakeHttp(handler) {
  return {
    post: async (url, body) => handler({ method: 'POST', url, body, headers: {} }),
    request: async (opts) => handler({
      method: opts.method,
      url: opts.url,
      body: opts.data,
      headers: opts.headers || {},
      query: opts.params,
    }),
  };
}

afterAll(async () => {
  await db('payment_attempts').del();
  await db('invoices').del();
  await db('subscriptions').del();
  await db.destroy();
});

beforeEach(async () => {
  await cleanupTables();
  await db('payment_attempts').del();
  await db('invoices').del();
  await db('subscriptions').del();
  parasut.__resetHttp();
  parasut.__setToken({ access_token: 't', refresh_token: 'r', expiresAt: Date.now() + 3600_000 });
});

async function seedPaidInvoice({ parasut_invoice_id = null, status = 'paid' } = {}) {
  const [sub] = await db('subscriptions').insert({
    site_id: 1,
    plan: 'standart',
    billing_cycle: 'monthly',
    status: 'active',
    provider: 'mock',
    provider_subscription_id: `sub_${Date.now()}_${Math.random()}`,
    current_period_start: new Date(),
    current_period_end: new Date(Date.now() + 30 * 86400 * 1000),
  }).returning('*');
  const [inv] = await db('invoices').insert({
    site_id: 1,
    subscription_id: sub.id,
    invoice_no: `2026-05-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    amount_excl_tax: 29900,
    tax_rate: 20,
    amount_incl_tax: 35880,
    period_start: new Date(),
    period_end: new Date(Date.now() + 30 * 86400 * 1000),
    status,
    paid_at: status === 'paid' ? new Date() : null,
    parasut_invoice_id,
  }).returning('*');
  return { sub, inv };
}

describe('issueInvoiceForPaidInvoice', () => {
  test('paid invoice → tam akış → parasut_invoice_id + pdf_url DB\'de', async () => {
    const { inv } = await seedPaidInvoice();
    await createTestUser({
      kullanici_adi: 'admin_for_parasut',
      rol: 'site_yonetici',
      site_id: 1,
    });

    const trace = [];
    parasut.__setHttp(makeFakeHttp(async (req) => {
      trace.push({ method: req.method, url: req.url });
      if (req.url.includes('/contacts') && req.method === 'GET') {
        return { data: { data: [] } };
      }
      if (req.url.includes('/contacts') && req.method === 'POST') {
        return { data: { data: { id: 'contact_new', attributes: {} } } };
      }
      if (req.url.endsWith('/sales_invoices')) {
        return { data: { data: { id: 'parasut_inv_555', attributes: {} } } };
      }
      if (req.url.includes('/e_archives')) {
        return { data: { data: {
          id: 'earc_1',
          attributes: { download_url: 'https://parasut.com/pdf/abc.pdf' },
        } } };
      }
      throw new Error('Unexpected: ' + req.url);
    }));

    const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
    expect(result.issued).toBe(true);
    expect(result.salesInvoiceId).toBe('parasut_inv_555');
    expect(result.pdfUrl).toBe('https://parasut.com/pdf/abc.pdf');

    const updated = await db('invoices').where({ id: inv.id }).first();
    expect(updated.parasut_invoice_id).toBe('parasut_inv_555');
    expect(updated.pdf_url).toBe('https://parasut.com/pdf/abc.pdf');

    expect(trace.map((t) => `${t.method} ${t.url.split('/v4/12345')[1]}`)).toEqual([
      'GET /contacts',
      'POST /contacts',
      'POST /sales_invoices',
      'POST /sales_invoices/parasut_inv_555/e_archives',
    ]);
  });

  test('zaten kesilmiş invoice → no-op', async () => {
    const { inv } = await seedPaidInvoice({ parasut_invoice_id: 'existing_id' });
    parasut.__setHttp(makeFakeHttp(async () => { throw new Error('Should not be called'); }));
    const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_issued');
  });

  test('paid değilse atla', async () => {
    const { inv } = await seedPaidInvoice({ status: 'pending' });
    const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invoice_status_pending');
  });

  test('env eksikse no-op (parasut_not_configured)', async () => {
    const orig = process.env.PARASUT_CLIENT_ID;
    delete process.env.PARASUT_CLIENT_ID;
    try {
      const { inv } = await seedPaidInvoice();
      const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('parasut_not_configured');
    } finally {
      process.env.PARASUT_CLIENT_ID = orig;
    }
  });

  test('e_archive submit fail → parasut_invoice_id yine kayıt, pdf_url NULL', async () => {
    const { inv } = await seedPaidInvoice();
    parasut.__setHttp(makeFakeHttp(async (req) => {
      if (req.url.includes('/contacts') && req.method === 'GET') return { data: { data: [] } };
      if (req.url.includes('/contacts') && req.method === 'POST') {
        return { data: { data: { id: 'contact_x', attributes: {} } } };
      }
      if (req.url.endsWith('/sales_invoices')) {
        return { data: { data: { id: 'pi_789', attributes: {} } } };
      }
      if (req.url.includes('/e_archives')) throw new Error('e_archive 503');
      throw new Error('Unexpected ' + req.url);
    }));
    const result = await parasut.issueInvoiceForPaidInvoice(inv.id);
    expect(result.issued).toBe(true);
    expect(result.salesInvoiceId).toBe('pi_789');
    expect(result.pdfUrl).toBeNull();
    const updated = await db('invoices').where({ id: inv.id }).first();
    expect(updated.parasut_invoice_id).toBe('pi_789');
    expect(updated.pdf_url).toBeNull();
  });
});
