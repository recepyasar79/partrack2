import { useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { XMarkIcon } from './ui/Icons';

// Site'nin WhatsApp bildirim numaralarını (en fazla 5) düzenleme modalı.
// Yalnız site yöneticisine açılır. Kaydedince /me yenilenip user.site güncellenir.
// Header'daki Ayarlar menüsünden ve Akşam Kontrolü akışından ortak kullanılır.
export default function NumaralarModal({ mevcut, onClose, onSaved }) {
  const toast = useToast();
  const [satirlar, setSatirlar] = useState(() => {
    const arr = [...(mevcut || [])];
    while (arr.length < 5) arr.push('');
    return arr.slice(0, 5);
  });
  const [busy, setBusy] = useState(false);

  function setSatir(i, val) {
    setSatirlar((prev) => prev.map((s, idx) => (idx === i ? val.replace(/[^\d]/g, '') : s)));
  }

  async function kaydet() {
    setBusy(true);
    try {
      const telefonlar = satirlar.map((s) => s.trim()).filter(Boolean);
      await api.put('/bildirimler/site-telefonlari', { telefonlar });
      toast.success('Bildirim numaraları kaydedildi.');
      onSaved();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-4 border border-transparent dark:border-slate-800 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Yönetim Bildirim Numaraları</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><XMarkIcon className="w-5 h-5" /></Button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Günün ihlal özeti bu numaralara (en fazla 5) WhatsApp ile gönderilir.
          Format: <span className="font-mono">05XXXXXXXXX</span>.
        </p>
        <div className="flex flex-col gap-2">
          {satirlar.map((s, i) => (
            <Input
              key={i}
              value={s}
              onChange={(e) => setSatir(i, e.target.value)}
              placeholder={`Numara ${i + 1} (örn. 05301234567)`}
              inputMode="numeric"
              maxLength={11}
              className="font-mono"
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>İptal</Button>
          <Button onClick={kaydet} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </div>
      </div>
    </div>
  );
}
