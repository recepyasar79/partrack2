import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DaireForm from './DaireForm';
import { ToastProvider } from './ui/Toast';

function setup(props = {}) {
  const onSubmit = vi.fn();
  render(
    <ToastProvider>
      <DaireForm onSubmit={onSubmit} {...props} />
    </ToastProvider>
  );
  return { onSubmit };
}

describe('DaireForm', () => {
  test('boş submit hata gösterir, onSubmit çağrılmaz', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Daire Ekle/i }));
    expect(await screen.findByText(/Daire numarası seçin/i)).toBeInTheDocument();
    expect(screen.getByText(/Ad-soyad en az 2 karakter/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('geçerli giriş onSubmit çağırır', async () => {
    const u = userEvent.setup();
    const { onSubmit } = setup();
    await u.selectOptions(screen.getByRole('combobox'), 'B5');
    await u.type(screen.getByLabelText('Ad Soyad'), 'Ahmet Yılmaz');
    await u.type(screen.getByLabelText('Telefon'), '05551234567');
    await u.click(screen.getByLabelText(/KVKK Açık Rızası/i));
    await u.click(screen.getByRole('button', { name: /Daire Ekle/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      daire_no: 'B5',
      sahip_ad: 'Ahmet Yılmaz',
      sahip_tel: '05551234567',
      kvkk_riza: true,
    }));
  });

  test('KVKK rızası olmadan submit reddedilir', async () => {
    const u = userEvent.setup();
    const { onSubmit } = setup();
    await u.selectOptions(screen.getByRole('combobox'), 'B5');
    await u.type(screen.getByLabelText('Ad Soyad'), 'Ali');
    await u.type(screen.getByLabelText('Telefon'), '05551234567');
    await u.click(screen.getByRole('button', { name: /Daire Ekle/i }));
    expect(await screen.findByText(/KVKK rızası zorunludur/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
