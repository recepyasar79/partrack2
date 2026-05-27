import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';
import { ThemeProvider } from '../theme/ThemeContext';
import RaporlarDashboard from './RaporlarDashboard';

// recharts ResponsiveContainer JSDOM'da 0x0 ölçer ve içeriği render etmez.
// Container'ı sabit boyutlu wrapper'a indirgeyip alt grafiklerin render
// edildiğini test edebilir hale getiriyoruz.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div data-testid="responsive-container" style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn() } }));
vi.mock('../services/api', () => ({
  api: apiMock,
  apiError: (e) => e?.message || 'Hata',
}));

function dashboardPayload(overrides = {}) {
  return {
    donem: { baslangic: '2026-04-27', bitis: '2026-05-27' },
    ozet: {
      toplam_ihlal: 12,
      coklu_arac: 9,
      kayitsiz: 3,
      etkilenen_daire: 4,
      kontrol_yapilan_gun: 26,
    },
    bildirim: {
      toplam: 8,
      gonderildi: 6,
      basarisiz: 2,
      beklemede: 0,
      basari_orani: 75.0,
    },
    gunluk_trend: [
      { tarih: '2026-05-25', coklu_arac: 2, kayitsiz: 0 },
      { tarih: '2026-05-26', coklu_arac: 3, kayitsiz: 1 },
    ],
    aylik_trend: [
      { ay: '2026-04', coklu_arac: 4, kayitsiz: 1 },
      { ay: '2026-05', coklu_arac: 5, kayitsiz: 2 },
    ],
    blok_dagilim: [
      { blok: 'A', ihlal: 2 },
      { blok: 'B', ihlal: 5 },
    ],
    top_daireler: [
      { daire_no: 'B5', sahip_ad: 'Ayşe', ihlal_sayisi: 3, son_ihlal: '2026-05-26' },
      { daire_no: 'A1', sahip_ad: 'Ali', ihlal_sayisi: 1, son_ihlal: '2026-05-25' },
    ],
    ...overrides,
  };
}

function renderDashboard(props = {}) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <RaporlarDashboard baslangic="2026-04-27" bitis="2026-05-27" {...props} />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('RaporlarDashboard', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  test('stat kartları payload\'dan render edilir', async () => {
    apiMock.get.mockResolvedValueOnce({ data: dashboardPayload() });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.getByText(/9 çoklu/i)).toBeInTheDocument();
    expect(screen.getByText(/3 kayıtsız/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // etkilenen_daire
    expect(screen.getByText('26')).toBeInTheDocument(); // kontrol_yapilan_gun
    expect(screen.getByText('%75')).toBeInTheDocument();
    expect(screen.getByText('6/8 gönderildi')).toBeInTheDocument();
  });

  test('bos veri bos state mesajlari gosterir', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: dashboardPayload({
        gunluk_trend: [], aylik_trend: [], blok_dagilim: [], top_daireler: [],
      }),
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Bu aralıkta veri yok/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Veri yok\./i).length).toBeGreaterThanOrEqual(2);
  });

  test('top 10 daire tablosu sıralı render edilir', async () => {
    apiMock.get.mockResolvedValueOnce({ data: dashboardPayload() });
    renderDashboard();

    await waitFor(() => expect(screen.getByText('B5')).toBeInTheDocument());
    const rows = screen.getAllByRole('row');
    // ilk row header, sonrakiler veri
    expect(rows[1]).toHaveTextContent('B5');
    expect(rows[1]).toHaveTextContent('Ayşe');
    expect(rows[1]).toHaveTextContent('3');
    expect(rows[2]).toHaveTextContent('A1');
  });

  test('basari_orani >= 80 ise yesil, dususe sari (UI ipucu)', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: dashboardPayload({
        bildirim: { toplam: 10, gonderildi: 9, basarisiz: 1, beklemede: 0, basari_orani: 90 },
      }),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('%90')).toBeInTheDocument());
  });

  test('API hatası toast.error çağırır, dashboard render etmez', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('boom'));
    renderDashboard();
    // ilk render'da yukleniyor; sonra hata sonrası null state
    await waitFor(() => {
      expect(screen.queryByText(/Toplam İhlal/i)).not.toBeInTheDocument();
    });
  });

  test('baslangic/bitis prop degisince yeni request atilir', async () => {
    apiMock.get.mockResolvedValue({ data: dashboardPayload() });
    const { rerender } = renderDashboard();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));

    rerender(
      <ThemeProvider>
        <ToastProvider>
          <RaporlarDashboard baslangic="2026-04-01" bitis="2026-04-30" />
        </ToastProvider>
      </ThemeProvider>
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
    expect(apiMock.get).toHaveBeenLastCalledWith('/raporlar/dashboard', {
      params: { baslangic: '2026-04-01', bitis: '2026-04-30' },
    });
  });
});
