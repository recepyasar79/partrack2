import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ui/Toast';
import AracListesi from './AracListesi';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { araclar: [] } }),
  },
  apiError: (e) => e.message || 'Hata',
}));

// useAuth gerçek context'i gerektirmesin
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { kullanici_adi: 'test', rol: 'site_yonetici' } }),
}));

function renderWithToast(ui) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('AracListesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sayfa başlığı görünür', () => {
    renderWithToast(<AracListesi />);
    expect(screen.getByRole('heading', { name: /tüm araç listesi/i })).toBeInTheDocument();
  });

  test('arama kutusu görünür ve placeholder doğru', () => {
    renderWithToast(<AracListesi />);
    expect(screen.getByPlaceholderText(/ara:/i)).toBeInTheDocument();
  });

  test('blok filtresi select elementı görünür', () => {
    renderWithToast(<AracListesi />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('CSV indir butonu görünür', () => {
    renderWithToast(<AracListesi />);
    // Türkçe 'İ' harfi (Unicode) sebebiyle regex case-folding her ortamda aynı değil.
    expect(screen.getByRole('button', { name: 'CSV İndir' })).toBeInTheDocument();
  });

  test('araç bulunamadı mesajı boş listede görünür', () => {
    renderWithToast(<AracListesi />);
    expect(screen.getByText(/araç bulunamadı/i)).toBeInTheDocument();
  });
});
