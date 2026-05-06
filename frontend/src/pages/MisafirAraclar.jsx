import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { isValidPlaka, normalizePlaka } from '../utils/validation';

export default function MisafirAraclar() {
  const toast = useToast();
  const { user } = useAuth();
  const isYonetici = user?.rol === 'yonetici';
  const [list, setList] = useState([]);
  const [daireler, setDaireler] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    daire_id: '',
    plaka: '',
    baslangic_tarihi: new Date().toISOString().slice(0, 10),
    bitis_tarihi: new Date().toISOString().slice(0, 10),
    aciklama: '',
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/misafir-araclar');
      setList(data.misafir_araclar);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function loadDaireler() {
    try {
      const { data } = await api.get('/daireler');
      setDaireler(data.daireler);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  useEffect(() => { load(); loadDaireler(); }, []); // eslint-disable-line

  async function gonder() {
    const p = normalizePlaka(form.plaka);
    if (!form.daire_id) return toast.error('Daire seçin.');
    if (!isValidPlaka(p)) return toast.error('Plaka formatı geçersiz.');
    setBusy(true);
    try {
      await api.post('/misafir-araclar', { ...form, plaka: p });
      toast.success('Misafir araç eklendi.');
      setShowForm(false);
      setForm({ ...form, plaka: '', aciklama: '' });
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function sil(id) {
    if (!window.confirm('Bu misafir kaydı silinsin mi?')) return;
    try {
      await api.delete(`/misafir-araclar/${id}`);
      toast.success('Silindi.');
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Misafir Araçlar</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Kapat' : '+ Yeni'}</Button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Daire</label>
            <select
              value={form.daire_id}
              onChange={(e) => setForm({ ...form, daire_id: e.target.value })}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3"
            >
              <option value="">Daire seçin…</option>
              {daireler.map((d) => (
                <option key={d.id} value={d.id}>{d.daire_no} — {d.sahip_ad}</option>
              ))}
            </select>
          </div>
          <Input label="Plaka" value={form.plaka} onChange={(e) => setForm({ ...form, plaka: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Başlangıç"
              type="date"
              value={form.baslangic_tarihi}
              onChange={(e) => setForm({ ...form, baslangic_tarihi: e.target.value })}
            />
            <Input
              label="Bitiş"
              type="date"
              value={form.bitis_tarihi}
              onChange={(e) => setForm({ ...form, bitis_tarihi: e.target.value })}
            />
          </div>
          <Input
            label="Açıklama"
            value={form.aciklama}
            onChange={(e) => setForm({ ...form, aciklama: e.target.value })}
          />
          <Button onClick={gonder} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="w-full text-base">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3">Plaka</th>
              <th className="p-3">Daire</th>
              <th className="p-3 hidden sm:table-cell">Tarih</th>
              <th className="p-3 hidden md:table-cell">Açıklama</th>
              {isYonetici && <th className="p-3"></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="p-3 font-mono">{m.plaka}</td>
                <td className="p-3 font-mono">{m.daire_no}</td>
                <td className="p-3 hidden sm:table-cell">{m.baslangic_tarihi?.slice(0,10)} → {m.bitis_tarihi?.slice(0,10)}</td>
                <td className="p-3 hidden md:table-cell text-slate-600">{m.aciklama}</td>
                {isYonetici && (
                  <td className="p-3 text-right">
                    <Button size="sm" variant="danger" onClick={() => sil(m.id)}>Sil</Button>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Misafir kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
