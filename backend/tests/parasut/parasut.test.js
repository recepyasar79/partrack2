/**
 * Paraşüt service unit testleri (Faz Ü3.7) — DB-less.
 *
 * HTTP mock + token cache, auth flow, JSON:API body shape doğrulanır.
 * DB gerektiren issueInvoiceForPaidInvoice + cron job integration test'i
 * ayrı dosyalarda (tests/parasut/issueInvoice.test.js, jobs/parasutSync.test.js).
 */
process.env.PARASUT_CLIENT_ID = 'cli_test';
process.env.PARASUT_CLIENT_SECRET = 'sec_test';
process.env.PARASUT_USERNAME = 'user@x.com';
process.env.PARASUT_PASSWORD = 'pw_test';
process.env.PARASUT_COMPANY_ID = '12345';
process.env.PARASUT_API_URL = 'https://api.parasut.com';

const parasut = require('../../src/services/parasut');

function makeFakeHttp(handler) {
  // Hem axios.post(url, body) hem axios.request({method, url, data, ...})
  // çağrılarını aynı `{method, url, body, headers}` shape'ine indirger.
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

afterEach(() => parasut.__resetHttp());

// ----------------------------------------------------------------------
// isConfigured
// ----------------------------------------------------------------------

describe('parasut.isConfigured', () => {
  test('tüm env varsa true', () => {
    expect(parasut.isConfigured()).toBe(true);
  });

  test('client_id eksikse false', () => {
    const orig = process.env.PARASUT_CLIENT_ID;
    delete process.env.PARASUT_CLIENT_ID;
    try {
      expect(parasut.isConfigured()).toBe(false);
    } finally {
      process.env.PARASUT_CLIENT_ID = orig;
    }
  });
});

// ----------------------------------------------------------------------
// OAuth + apiRequest
// ----------------------------------------------------------------------

describe('parasut auth/api', () => {
  test('ilk istek password grant ile token alır', async () => {
    const calls = [];
    parasut.__setHttp(makeFakeHttp(async (req) => {
      calls.push(req);
      if (req.url.endsWith('/oauth/token')) {
        return { data: { access_token: 'tok_1', refresh_token: 'ref_1', expires_in: 3600 } };
      }
      return { data: { data: [{ id: 'contact_99' }] } };
    }));

    const id = await parasut.findOrCreateContact({ email: 'x@y.com', name: 'X' });
    expect(id).toBe('contact_99');
    expect(calls[0].url).toContain('/oauth/token');
    expect(calls[0].body.grant_type).toBe('password');
    expect(calls[1].headers.Authorization).toBe('Bearer tok_1');
    expect(calls[1].headers['Content-Type']).toBe('application/vnd.api+json');
  });

  test('cache içinde token varsa /oauth/token çağrılmaz', async () => {
    parasut.__setToken({
      access_token: 'cached_tok', refresh_token: 'r', expiresAt: Date.now() + 3600_000,
    });
    let oauthCalled = false;
    parasut.__setHttp(makeFakeHttp(async (req) => {
      if (req.url.endsWith('/oauth/token')) oauthCalled = true;
      return { data: { data: [{ id: 'c1' }] } };
    }));
    await parasut.findOrCreateContact({ email: 'x', name: 'X' });
    expect(oauthCalled).toBe(false);
  });

  test('401 alınca token sıfırlanır + tekrar dener', async () => {
    parasut.__setToken({
      access_token: 'stale_tok', refresh_token: 'r', expiresAt: Date.now() + 3600_000,
    });
    let phase = 0;
    parasut.__setHttp(makeFakeHttp(async (req) => {
      if (req.url.endsWith('/oauth/token')) {
        return { data: { access_token: 'fresh_tok', refresh_token: 'r2', expires_in: 3600 } };
      }
      phase += 1;
      if (phase === 1) {
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      }
      return { data: { data: [{ id: 'c_after_retry' }] } };
    }));
    const id = await parasut.findOrCreateContact({ email: 'x', name: 'X' });
    expect(id).toBe('c_after_retry');
    expect(phase).toBe(2);
  });
});

// ----------------------------------------------------------------------
// Domain helpers (no DB)
// ----------------------------------------------------------------------

describe('parasut.findOrCreateContact', () => {
  beforeEach(() => parasut.__setToken({
    access_token: 't', refresh_token: 'r', expiresAt: Date.now() + 3600_000,
  }));

  test('mevcut contact → existing id döner, POST atılmaz', async () => {
    let postCalled = false;
    parasut.__setHttp(makeFakeHttp(async (req) => {
      if (req.method === 'POST') postCalled = true;
      return { data: { data: [{ id: 'existing_42' }] } };
    }));
    const id = await parasut.findOrCreateContact({ email: 'a@b.com', name: 'A' });
    expect(id).toBe('existing_42');
    expect(postCalled).toBe(false);
  });

  test('contact yoksa POST ile oluştur', async () => {
    let postBody = null;
    parasut.__setHttp(makeFakeHttp(async (req) => {
      if (req.method === 'GET') return { data: { data: [] } };
      postBody = req.body;
      return { data: { data: { id: 'created_77', attributes: {} } } };
    }));
    const id = await parasut.findOrCreateContact({ email: 'new@x.com', name: 'New User' });
    expect(id).toBe('created_77');
    expect(postBody.data.type).toBe('contacts');
    expect(postBody.data.attributes.email).toBe('new@x.com');
    expect(postBody.data.attributes.account_type).toBe('customer');
  });
});

describe('parasut.createSalesInvoice', () => {
  beforeEach(() => parasut.__setToken({
    access_token: 't', refresh_token: 'r', expiresAt: Date.now() + 3600_000,
  }));

  test('JSON:API body — kuruş → TL dönüşümü + KDV', async () => {
    let captured;
    parasut.__setHttp(makeFakeHttp(async (req) => {
      captured = req.body;
      return { data: { data: { id: 'inv_paras_1', attributes: {} } } };
    }));
    const inv = await parasut.createSalesInvoice({
      contactId: 'c1',
      invoice: {
        amount_excl_tax: 29900,
        tax_rate: 20,
        invoice_no: '2026-05-00042',
        issued_at: '2026-05-27T10:00:00Z',
      },
      planLabel: 'standart (aylık)',
    });
    expect(inv.id).toBe('inv_paras_1');
    expect(captured.data.type).toBe('sales_invoices');
    expect(captured.data.attributes.issue_date).toBe('2026-05-27');
    expect(captured.included[0].attributes.unit_price).toBe(299);
    expect(captured.included[0].attributes.vat_rate).toBe(20);
    expect(captured.data.relationships.contact.data.id).toBe('c1');
  });
});

describe('parasut.submitEArchive', () => {
  beforeEach(() => parasut.__setToken({
    access_token: 't', refresh_token: 'r', expiresAt: Date.now() + 3600_000,
  }));

  test('e_archives POST → download_url döner', async () => {
    parasut.__setHttp(makeFakeHttp(async () => ({
      data: { data: { id: 'ea_1', attributes: { download_url: 'https://p/x.pdf' } } },
    })));
    const ea = await parasut.submitEArchive('inv_99', 'x@y.com');
    expect(ea.id).toBe('ea_1');
    expect(ea.attributes.download_url).toBe('https://p/x.pdf');
  });
});
