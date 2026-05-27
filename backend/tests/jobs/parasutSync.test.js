/**
 * parasutSync cron job testleri (Faz Ü3.7).
 *
 * Pending invoice'leri toplu işler, bireysel fail batch'i durdurmaz.
 */
process.env.PARASUT_CLIENT_ID = 'cli';
process.env.PARASUT_CLIENT_SECRET = 'sec';
process.env.PARASUT_USERNAME = 'u';
process.env.PARASUT_PASSWORD = 'p';
process.env.PARASUT_COMPANY_ID = '1';

const { syncPendingInvoices } = require('../../src/jobs/parasutSync');
const parasut = require('../../src/services/parasut');
const { db, cleanupTables } = require('../helpers');

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
});

async function seedInvoice({ status, parasut_invoice_id = null }) {
  const [sub] = await db('subscriptions').insert({
    site_id: 1, plan: 'standart', billing_cycle: 'monthly',
    status: 'active', provider: 'mock',
    provider_subscription_id: `sub_${Date.now()}_${Math.random()}`,
    current_period_start: new Date(),
    current_period_end: new Date(Date.now() + 30 * 86400 * 1000),
  }).returning('*');
  const [inv] = await db('invoices').insert({
    site_id: 1, subscription_id: sub.id,
    invoice_no: `2026-05-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    amount_excl_tax: 29900, tax_rate: 20, amount_incl_tax: 35880,
    period_start: new Date(), period_end: new Date(Date.now() + 30 * 86400 * 1000),
    status, parasut_invoice_id,
  }).returning('*');
  return inv;
}

describe('syncPendingInvoices', () => {
  test('paid + parasut_invoice_id NULL olanları işler', async () => {
    const inv1 = await seedInvoice({ status: 'paid' });
    const inv2 = await seedInvoice({ status: 'paid' });
    await seedInvoice({ status: 'pending' }); // skip — paid değil
    await seedInvoice({ status: 'paid', parasut_invoice_id: 'already' }); // skip — zaten kesilmiş

    let counter = 0;
    parasut.__setHttp({
      post: async () => ({ data: { access_token: 't', expires_in: 3600 } }),
      request: async (opts) => {
        if (opts.url.includes('/contacts') && opts.method === 'GET') {
          return { data: { data: [] } };
        }
        if (opts.url.includes('/contacts') && opts.method === 'POST') {
          return { data: { data: { id: `c_${counter}` } } };
        }
        if (opts.url.endsWith('/sales_invoices')) {
          counter += 1;
          return { data: { data: { id: `pi_${counter}` } } };
        }
        if (opts.url.includes('/e_archives')) {
          return { data: { data: {
            id: 'e1', attributes: { download_url: `https://x/pdf${counter}.pdf` },
          } } };
        }
        throw new Error('Unexpected ' + opts.url);
      },
    });
    parasut.__setToken({ access_token: 't', expiresAt: Date.now() + 3600_000 });

    const r = await syncPendingInvoices();
    expect(r.total).toBe(2);
    expect(r.issued).toBe(2);
    expect(r.failed).toBe(0);

    const a = await db('invoices').where({ id: inv1.id }).first();
    const b = await db('invoices').where({ id: inv2.id }).first();
    expect(a.parasut_invoice_id).not.toBeNull();
    expect(b.parasut_invoice_id).not.toBeNull();
  });

  test('bireysel fail batch\'i durdurmaz', async () => {
    const inv1 = await seedInvoice({ status: 'paid' });
    const inv2 = await seedInvoice({ status: 'paid' });
    let n = 0;
    parasut.__setHttp({
      post: async () => ({ data: { access_token: 't', expires_in: 3600 } }),
      request: async (opts) => {
        if (opts.url.includes('/contacts') && opts.method === 'GET') {
          return { data: { data: [] } };
        }
        if (opts.url.includes('/contacts') && opts.method === 'POST') {
          return { data: { data: { id: 'c' } } };
        }
        if (opts.url.endsWith('/sales_invoices')) {
          n += 1;
          if (n === 1) throw new Error('Paraşüt 500');
          return { data: { data: { id: 'pi_ok' } } };
        }
        if (opts.url.includes('/e_archives')) {
          return { data: { data: { id: 'e', attributes: {} } } };
        }
        throw new Error('Unexpected ' + opts.url);
      },
    });
    parasut.__setToken({ access_token: 't', expiresAt: Date.now() + 3600_000 });

    const r = await syncPendingInvoices();
    expect(r.total).toBe(2);
    expect(r.issued).toBe(1);
    expect(r.failed).toBe(1);

    // İlk invoice fail oldu → parasut_invoice_id NULL kaldı
    const a = await db('invoices').where({ id: inv1.id }).first();
    const b = await db('invoices').where({ id: inv2.id }).first();
    expect(a.parasut_invoice_id).toBeNull();
    expect(b.parasut_invoice_id).toBe('pi_ok');
  });

  test('env eksikse skipped + count 0', async () => {
    const orig = process.env.PARASUT_CLIENT_ID;
    delete process.env.PARASUT_CLIENT_ID;
    try {
      const r = await syncPendingInvoices();
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('parasut_not_configured');
      expect(r.count).toBe(0);
    } finally {
      process.env.PARASUT_CLIENT_ID = orig;
    }
  });
});
