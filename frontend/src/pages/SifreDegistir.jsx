import { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';

export default function SifreDegistir() {
  const toast = useToast();
  const [eski, setEski] = useState('');
  const [yeni, setYeni] = useState('');
  const [yeni2, setYeni2] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (yeni.length < 8) return toast.error('Yeni şifre en az 8 karakter olmalı.');
    if (yeni !== yeni2) return toast.error('Yeni şifreler eşleşmiyor.');
    setBusy(true);
    try {
      await api.post('/auth/sifre-degistir', { eski_sifre: eski, yeni_sifre: yeni });
      toast.success('Şifre değiştirildi.');
      setEski(''); setYeni(''); setYeni2('');
    } catch (e2) {
      toast.error(apiError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Şifre Değiştir</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 bg-white rounded-2xl shadow p-4">
        <Input label="Mevcut şifre" type="password" value={eski} onChange={(e) => setEski(e.target.value)} />
        <Input label="Yeni şifre" type="password" value={yeni} onChange={(e) => setYeni(e.target.value)} />
        <Input label="Yeni şifre (tekrar)" type="password" value={yeni2} onChange={(e) => setYeni2(e.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      </form>
    </div>
  );
}
