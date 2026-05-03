import { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { isValidPlaka, normalizePlaka } from '../utils/validation';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';

export default function PlakaListesi({ daireId, araclar, onChanged, canEdit }) {
  const toast = useToast();
  const [plaka, setPlaka] = useState('');
  const [busy, setBusy] = useState(false);

  async function ekle() {
    const p = normalizePlaka(plaka);
    if (!isValidPlaka(p)) return toast.error('Plaka formatı geçersiz.');
    setBusy(true);
    try {
      await api.post('/araclar', { daire_id: daireId, plaka: p });
      setPlaka('');
      toast.success('Plaka eklendi.');
      onChanged && onChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function sil(id) {
    if (!window.confirm('Bu plakayı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/araclar/${id}`);
      toast.success('Plaka silindi.');
      onChanged && onChanged();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
      <h3 className="font-semibold">Tanımlı Araçlar</h3>
      {araclar?.length ? (
        <ul className="divide-y divide-slate-100">
          {araclar.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span className="font-mono">{a.plaka}</span>
              {canEdit && (
                <Button size="sm" variant="danger" onClick={() => sil(a.id)}>Sil</Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Henüz araç tanımlanmamış.</p>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <Input
            placeholder="Yeni plaka (örn 34ABC123)"
            value={plaka}
            onChange={(e) => setPlaka(e.target.value)}
            containerClassName="flex-1"
          />
          <Button onClick={ekle} disabled={busy}>Ekle</Button>
        </div>
      )}
    </div>
  );
}
