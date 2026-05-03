import { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { isValidTelefon, formatTelefon, unformatTelefon } from '../utils/validation';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';

export default function SahipDegistirModal({ daire, onClose, onSaved }) {
  const toast = useToast();
  const [ad, setAd] = useState('');
  const [tel, setTel] = useState('');
  const [kvkk, setKvkk] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (!ad || ad.trim().length < 2) return toast.error('Ad-soyad zorunlu.');
    if (!isValidTelefon(unformatTelefon(tel))) return toast.error('Telefon geçersiz.');
    if (!kvkk) return toast.error('Yeni sahip için KVKK rızası zorunlu.');
    setBusy(true);
    try {
      await api.post(`/daireler/${daire.id}/sahip-degistir`, {
        yeni_sahip_ad: ad.trim(),
        yeni_sahip_tel: unformatTelefon(tel),
        kvkk_riza: kvkk,
        bildirim_opt_in: optIn,
      });
      toast.success('Sahip değişikliği kaydedildi.');
      onSaved && onSaved();
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-3">
        <h2 className="text-lg font-bold">{daire.daire_no} — Sahip Değiştir</h2>
        <p className="text-sm text-slate-600">
          Eski sahip <strong>{daire.sahip_ad}</strong> tarihçeye taşınacak.
        </p>
        <Input label="Yeni sahip ad-soyad" value={ad} onChange={(e) => setAd(e.target.value)} />
        <Input
          label="Yeni sahip telefon"
          value={tel}
          onChange={(e) => setTel(formatTelefon(e.target.value))}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} className="mt-1 h-5 w-5" />
          <span>Yeni sahip KVKK rızası verdiğini onayladı.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-1 h-5 w-5" />
          <span>WhatsApp bildirimi onayı</span>
        </label>
        <div className="flex gap-2 justify-end mt-2">
          <Button variant="secondary" onClick={onClose}>İptal</Button>
          <Button onClick={handle} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </div>
      </div>
    </div>
  );
}
