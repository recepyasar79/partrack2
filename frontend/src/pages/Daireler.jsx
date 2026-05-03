import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import DaireForm from '../components/DaireForm';
import PlakaListesi from '../components/PlakaListesi';
import SahipDegistirModal from '../components/SahipDegistirModal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { BLOKLAR } from '../utils/constants';

export default function Daireler() {
  const toast = useToast();
  const { user } = useAuth();
  const isYonetici = user?.rol === 'yonetici';
  const [daireler, setDaireler] = useState([]);
  const [q, setQ] = useState('');
  const [blok, setBlok] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState(null);
  const [araclar, setAraclar] = useState([]);
  const [sahipDegistir, setSahipDegistir] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 25;

  async function load() {
    try {
      const params = {};
      if (q) params.q = q;
      if (blok) params.blok = blok;
      const { data } = await api.get('/daireler', { params });
      setDaireler(data.daireler);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  useEffect(() => {
    load();
  }, [q, blok]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail(id) {
    try {
      const { data } = await api.get(`/daireler/${id}`);
      setSelected(data.daire);
      setAraclar(data.araclar);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function onCreate(payload) {
    setBusy(true);
    try {
      await api.post('/daireler', payload);
      toast.success('Daire kaydedildi.');
      setShowForm(false);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    if (!window.confirm('Bu daireyi silmek istediğinize emin misiniz? Tanımlı araçları da silinecek.')) return;
    try {
      await api.delete(`/daireler/${id}`);
      toast.success('Daire silindi.');
      if (selected?.id === id) setSelected(null);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  const paged = daireler.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(daireler.length / PER_PAGE));

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-2xl font-bold">Daire Yönetimi</h1>
        {isYonetici && (
          <div className="flex gap-2">
            <Button onClick={() => setShowImport(true)} variant="secondary">Toplu İçe Aktar</Button>
            <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Kapat' : '+ Yeni Daire'}</Button>
          </div>
        )}
      </div>

      {showForm && isYonetici && (
        <DaireForm onSubmit={onCreate} busy={busy} />
      )}
      {showImport && isYonetici && (
        <BulkImport onClose={() => { setShowImport(false); load(); }} />
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Ara: daire no / ad / telefon"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          containerClassName="flex-1 min-w-[200px]"
        />
        <select
          value={blok}
          onChange={(e) => setBlok(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3"
        >
          <option value="">Tüm bloklar</option>
          {BLOKLAR.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3">Daire</th>
              <th className="p-3">Sahip</th>
              <th className="p-3 hidden sm:table-cell">Telefon</th>
              <th className="p-3 hidden md:table-cell">Opt-in</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {paged.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="p-3 font-mono font-semibold">{d.daire_no}</td>
                <td className="p-3">{d.sahip_ad}</td>
                <td className="p-3 hidden sm:table-cell">{d.sahip_tel}</td>
                <td className="p-3 hidden md:table-cell">{d.bildirim_opt_in ? '✓' : '—'}</td>
                <td className="p-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => loadDetail(d.id)}>Detay</Button>
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Daire bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 border-t border-slate-100">
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ Önceki</Button>
            <span className="text-sm py-2">{page} / {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Sonraki ›</Button>
          </div>
        )}
      </div>

      {selected && (
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold">
              {selected.daire_no} — {selected.sahip_ad}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Kapat</Button>
          </div>
          <div className="text-sm text-slate-600">
            Telefon: {selected.sahip_tel} • KVKK: {selected.kvkk_riza ? '✓' : '—'} • WhatsApp: {selected.bildirim_opt_in ? '✓' : '—'}
          </div>
          <PlakaListesi
            daireId={selected.id}
            araclar={araclar}
            onChanged={() => loadDetail(selected.id)}
            canEdit={isYonetici}
          />
          {isYonetici && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSahipDegistir(selected)}>Sahip Değiştir</Button>
              <Button variant="danger" onClick={() => onDelete(selected.id)}>Daireyi Sil</Button>
            </div>
          )}
        </div>
      )}

      {sahipDegistir && (
        <SahipDegistirModal
          daire={sahipDegistir}
          onClose={() => setSahipDegistir(null)}
          onSaved={() => { load(); if (selected) loadDetail(selected.id); }}
        />
      )}
    </div>
  );
}

function BulkImport({ onClose }) {
  const toast = useToast();
  const [text, setText] = useState('daire_no;sahip_ad;sahip_tel;kvkk_riza;bildirim_opt_in\n');
  const [busy, setBusy] = useState(false);
  const [sonuc, setSonuc] = useState(null);

  async function gonder() {
    const lines = text.trim().split('\n');
    const [headerLine, ...rest] = lines;
    const headers = headerLine.split(';').map((h) => h.trim());
    const satirlar = rest.map((l) => {
      const cols = l.split(';');
      const o = {};
      headers.forEach((h, i) => { o[h] = (cols[i] || '').trim(); });
      o.kvkk_riza = ['true', '1', 'evet'].includes((o.kvkk_riza || '').toLowerCase());
      o.bildirim_opt_in = ['true', '1', 'evet'].includes((o.bildirim_opt_in || '').toLowerCase());
      return o;
    }).filter((o) => o.daire_no);

    setBusy(true);
    try {
      const { data } = await api.post('/daireler/bulk-import', { satirlar });
      setSonuc(data);
      toast.success(`${data.eklenenler.length} satır eklendi, ${data.hatalar.length} hata.`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Toplu İçe Aktar (CSV ; ayraçlı)</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Kapat</Button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="font-mono text-sm border border-slate-300 rounded-lg p-3"
      />
      <Button onClick={gonder} disabled={busy}>{busy ? 'Yükleniyor…' : 'Gönder'}</Button>
      {sonuc && (
        <div className="text-sm">
          <p className="text-green-700">Eklenen: {sonuc.eklenenler.length}</p>
          {sonuc.hatalar.length > 0 && (
            <details className="mt-2">
              <summary className="text-red-700 cursor-pointer">Hatalar ({sonuc.hatalar.length})</summary>
              <ul className="mt-1 ml-4 list-disc">
                {sonuc.hatalar.map((h, i) => (
                  <li key={i}>Satır {h.satir} ({h.daire_no}): {h.hata}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
