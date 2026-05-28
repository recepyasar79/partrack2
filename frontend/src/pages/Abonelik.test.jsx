import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ui/Toast';
import Abonelik from './Abonelik';

const { apiMock, authMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  authMock: { user: null, refresh: vi.fn() },
}));

vi.mock('../services/api', () => ({
  api: apiMock,
  apiError: (e) => e?.response?.data?.error || e?.message || 'Hata',
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authMock,
}));

function renderAbonelik() {
  return render(
    <ToastProvider>
      <Abonelik />
    </ToastProvider>
  );
}

function setUser(rol, site = { plan: 'baslangic' }) {
  authMock.user = { kullanici_adi: 'admin', rol, site };
}

describe('Abonelik', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    authMock.refresh.mockReset();
    // Default mock — component her zaman useEffect'te fetch eder (rol kontrolü
    // render'da). Spesifik test gerekliyse mockResolvedValueOnce ile ezilir.
    apiMock.get.mockResolvedValue({ data: { subscription: null, invoices: [] } });
    setUser('site_yonetici');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('site_yonetici dışındaki rol uyarı görür ve fetch atılmaz', async () => {
    setUser('guvenlik');
    renderAbonelik();
    expect(await screen.findByText(/yalnızca site yöneticilerine açıktır/i)).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  test('subscription yokken plan kartları + "Abone Ol" butonları', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { subscription: null, invoices: [] } });
    renderAbonelik();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Abonelik' })).toBeInTheDocument());
    // Hem mevcut plan kartında "Başlangıç" hem plan grid'inde — toplam ≥ 1
    expect(screen.getAllByText('Başlangıç').length).toBeGreaterThan(0);
    expect(screen.getByText('Standart')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Kurumsal')).toBeInTheDocument();
    // baslangic ücretsiz mesajı
    expect(screen.getByText(/Ücretsiz başlangıç planı — abonelik gerekmez\./i)).toBeInTheDocument();
    // standart + pro için "Abone Ol" butonları
    const aboneButtons = screen.getAllByRole('button', { name: /^Abone Ol$/ });
    expect(aboneButtons.length).toBeGreaterThanOrEqual(2);
  });

  test('aktif sub varken durum + iptal butonu, fatura geçmişi', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        subscription: {
          id: 1, plan: 'standart', billing_cycle: 'monthly',
          status: 'active', cancel_at_period_end: false,
          current_period_end: '2026-06-27T00:00:00Z',
        },
        invoices: [
          { id: 1, invoice_no: '202605-001', issued_at: '2026-05-27T10:00:00Z',
            period_start: '2026-05-27', period_end: '2026-06-27',
            amount_incl_tax: 35880, status: 'paid', pdf_url: 'https://example.com/inv.pdf' },
        ],
      },
    });
    renderAbonelik();
    await waitFor(() => expect(screen.getAllByText('Standart').length).toBeGreaterThan(0));
    expect(screen.getByText('Aktif')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /İptal Et/i })).toBeInTheDocument();
    // fatura
    expect(screen.getByRole('heading', { name: /Fatura Geçmişi/i })).toBeInTheDocument();
    expect(screen.getByText('202605-001')).toBeInTheDocument();
    expect(screen.getByText('Ödendi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /İndir/i })).toHaveAttribute('href', 'https://example.com/inv.pdf');
  });

  test('cancel_at_period_end ise "İptali Geri Al" butonu görünür', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        subscription: {
          id: 1, plan: 'pro', billing_cycle: 'yearly',
          status: 'active', cancel_at_period_end: true,
          current_period_end: '2026-12-31T00:00:00Z',
        },
        invoices: [],
      },
    });
    renderAbonelik();
    // 'Pro' hem mevcut plan kartında hem plan grid'inde → getAllByText
    await waitFor(() => expect(screen.getAllByText('Pro').length).toBeGreaterThan(0));
    expect(screen.getByText(/Period sonu iptal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /İptali Geri Al/i })).toBeInTheDocument();
  });

  test('İptal butonu /cancel POST eder ve reload yapar', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        subscription: { id: 1, plan: 'standart', billing_cycle: 'monthly', status: 'active', cancel_at_period_end: false, current_period_end: '2026-06-27T00:00:00Z' },
        invoices: [],
      },
    });
    apiMock.post.mockResolvedValueOnce({ data: {} });
    apiMock.get.mockResolvedValueOnce({
      data: {
        subscription: { id: 1, plan: 'standart', billing_cycle: 'monthly', status: 'active', cancel_at_period_end: true, current_period_end: '2026-06-27T00:00:00Z' },
        invoices: [],
      },
    });

    const user = userEvent.setup();
    renderAbonelik();
    await waitFor(() => expect(screen.getByRole('button', { name: /İptal Et/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /İptal Et/i }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/site/subscription/cancel'));
    await waitFor(() => expect(authMock.refresh).toHaveBeenCalled());
  });

  test('cycle toggle aylık ↔ yıllık + indirim badge', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { subscription: null, invoices: [] } });
    const user = userEvent.setup();
    renderAbonelik();
    await waitFor(() => expect(screen.getByText('Standart')).toBeInTheDocument());
    // default aylık
    expect(screen.getByText(/-%20/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Yıllık/i }));
    // yıllık seçilince Standart fiyatı görünür değişir; '/yıl' suffix gelir
    expect(screen.getAllByText(/\/yıl/i).length).toBeGreaterThan(0);
  });
});
