import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ui/Toast';
import SahipTarihce from './SahipTarihce';

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn() } }));
vi.mock('../services/api', () => ({
  api: apiMock,
  apiError: (e) => e?.message || 'Hata',
}));

function renderTarihce(props = {}) {
  return render(
    <ToastProvider>
      <SahipTarihce daireId={42} {...props} />
    </ToastProvider>
  );
}

describe('SahipTarihce', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  test('default kapalı; toggle butonu görünür', () => {
    renderTarihce();
    expect(screen.getByRole('button', { name: /Eski Sahipler/i })).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  test('ilk tıklamada lazy load tetiklenir', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { tarihce: [] } });
    const user = userEvent.setup();
    renderTarihce();
    await user.click(screen.getByRole('button', { name: /Eski Sahipler/i }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/daireler/42/sahip-tarihce'));
  });

  test('boş tarihçe için italik mesaj gösterir', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { tarihce: [] } });
    const user = userEvent.setup();
    renderTarihce();
    await user.click(screen.getByRole('button', { name: /Eski Sahipler/i }));
    await waitFor(() => {
      expect(screen.getByText(/Eski sahip kaydı yok\./i)).toBeInTheDocument();
    });
  });

  test('eski sahipleri liste olarak gösterir, telefon backend\'ten gelir', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        tarihce: [
          {
            id: 1,
            sahip_ad: 'Ali Veli',
            sahip_tel: '0555***4567',
            baslangic_tarihi: '2024-01-15',
            bitis_tarihi: '2025-06-30',
          },
          {
            id: 2,
            sahip_ad: 'Ayşe Y.',
            sahip_tel: '05551234567',
            baslangic_tarihi: '2023-03-01',
            bitis_tarihi: '2024-01-14',
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderTarihce();
    await user.click(screen.getByRole('button', { name: /Eski Sahipler/i }));
    await waitFor(() => expect(screen.getByText('Ali Veli')).toBeInTheDocument());
    expect(screen.getByText(/0555\*\*\*4567/)).toBeInTheDocument(); // maskeli (rol bazlı, backend yapar)
    expect(screen.getByText('Ayşe Y.')).toBeInTheDocument();
    expect(screen.getByText(/05551234567/)).toBeInTheDocument(); // maskesiz
    // counter butonda
    expect(screen.getByRole('button', { name: /Eski Sahipler.*\(2\)/i })).toBeInTheDocument();
  });

  test('toggle ikinci tıklamada kapanır, üçüncüde re-fetch yok (cache)', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { tarihce: [{ id: 1, sahip_ad: 'X', sahip_tel: '05551110000', baslangic_tarihi: '2024-01-01', bitis_tarihi: '2025-01-01' }] } });
    const user = userEvent.setup();
    renderTarihce();
    const btn = screen.getByRole('button', { name: /Eski Sahipler/i });
    await user.click(btn);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
    await user.click(btn); // kapat
    await user.click(btn); // tekrar aç → items zaten dolu, refetch yok
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });

  test('daireId değişince state reset olur', async () => {
    apiMock.get.mockResolvedValue({ data: { tarihce: [] } });
    const user = userEvent.setup();
    const { rerender } = renderTarihce({ daireId: 1 });
    await user.click(screen.getByRole('button', { name: /Eski Sahipler/i }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/daireler/1/sahip-tarihce'));

    rerender(
      <ToastProvider>
        <SahipTarihce daireId={2} />
      </ToastProvider>
    );
    // yeni daire'de accordion default kapalı, henüz fetch yok
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Eski Sahipler/i }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/daireler/2/sahip-tarihce'));
  });
});
