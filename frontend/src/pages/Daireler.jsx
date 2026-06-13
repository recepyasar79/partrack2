import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import DaireForm from '../components/DaireForm';
import PlakaListesi from '../components/PlakaListesi';
import SahipDegistirModal from '../components/SahipDegistirModal';
import SahipTarihce from '../components/SahipTarihce';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
// BLOKLAR artık site'nin blok_yapisi'sından dinamik gelir (Ü1.11).
import { MagnifyingGlassIcon, PlusIcon, DocumentArrowUpIcon, XMarkIcon, ChevronDownIcon } from '../components/ui/Icons';

export default function Daireler() {
  const toast = useToast();
  const { user } = useAuth();
  const isYonetici = user?.rol === 'site_yonetici' || user?.rol === 'superadmin';
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Daire Yönetimi</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{daireler.length} daire kayıtlı</p>
        </div>
        {isYonetici && (
          <div className="flex gap-2">
            {/* Toplu İçe Aktar — şimdilik gizli (kullanıcı isteği). Geri açmak için yorumu kaldır.
            <Button onClick={() => setShowImport(true)} variant="secondary" size="md">
              <DocumentArrowUpIcon className="w-5 h-5 mr-1.5" />
              Toplu İçe Aktar
            </Button>
            */}
            <Button onClick={() => setShowForm((s) => !s)} size="md">
              {showForm ? (
                <><XMarkIcon className="w-5 h-5 mr-1.5" /> Kapat</>
              ) : (
                <><PlusIcon className="w-5 h-5 mr-1.5" /> Yeni Daire</>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Form Panel */}
      {showForm && isYonetici && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 animate-scale-in">
          <DaireForm onSubmit={onCreate} busy={busy} onCancel={() => setShowForm(false)} />
        </div>
      )}
      
      {/* Import Panel */}
      {showImport && isYonetici && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 animate-scale-in">
          <BulkImport onClose={() => { setShowImport(false); load(); }} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-4">
        <div className="flex-1">
          <Input
            placeholder="Ara: daire no / ad / telefon"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            icon={MagnifyingGlassIcon}
          />
        </div>
        <Select
          value={blok}
          onChange={(e) => setBlok(e.target.value)}
          containerClassName="sm:w-40"
        >
          <option value="">Tüm bloklar</option>
          {(user?.site?.blok_yapisi || []).map((b) => (
            <option key={b.ad} value={b.ad}>{b.ad} Blok</option>
          ))}
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-800 text-left">
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200">Daire</th>
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200">Adı Soyadı</th>
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200 hidden sm:table-cell">Telefon</th>
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200 hidden md:table-cell text-center">Opt-in</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.map((d, index) => (
                <tr
                  key={d.id}
                  className={`
                    hover:bg-brand-50/50 dark:hover:bg-brand-900/20 transition-colors cursor-pointer
                    ${selected?.id === d.id ? 'bg-brand-50 dark:bg-brand-900/30' : ''}
                    ${index % 2 === 1 ? 'bg-slate-50/30 dark:bg-slate-800/30' : ''}
                  `}
                  onClick={() => loadDetail(d.id)}
                >
                  <td className="p-4">
                    <div className="font-mono font-bold text-brand-700 dark:text-brand-300">{d.daire_no}</div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{d.sahip_ad}</div>
                  </td>
                  <td className="p-4 hidden sm:table-cell text-slate-600 dark:text-slate-300">{d.sahip_tel}</td>
                  <td className="p-4 hidden md:table-cell text-center">
                    {d.bildirim_opt_in ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300 rounded-full text-xs font-semibold">✓</span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-6 h-6 bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 rounded-full text-xs">—</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); loadDetail(d.id); }}>
                      Detay
                    </Button>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                      <MagnifyingGlassIcon className="w-8 h-8" />
                      <p>Daire bulunamadı.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Sayfa {page} / {totalPages} ({daireler.length} kayıt)
            </span>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="ghost" 
                disabled={page === 1} 
                onClick={() => setPage((p) => p - 1)}
              >
                ‹ Önceki
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                disabled={page === totalPages} 
                onClick={() => setPage((p) => p + 1)}
              >
                Sonraki ›
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-brand-200 dark:border-brand-800 p-6 flex flex-col gap-4 animate-scale-in w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span className="w-10 h-10 bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 rounded-xl flex items-center justify-center font-mono text-lg">
                    {selected.daire_no}
                  </span>
                  {selected.sahip_ad}
                </h2>
                <div className="flex gap-4 mt-2 text-sm text-slate-500 dark:text-slate-400">
                  <span>📞 {selected.sahip_tel}</span>
                  <span className={selected.kvkk_riza ? 'text-green-600 dark:text-green-400' : ''}>
                    KVKK: {selected.kvkk_riza ? '✓ Onaylı' : '—'}
                  </span>
                  <span className={selected.bildirim_opt_in ? 'text-green-600 dark:text-green-400' : ''}>
                    WhatsApp: {selected.bildirim_opt_in ? '✓ Aktif' : '—'}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <XMarkIcon className="w-5 h-5" />
              </Button>
            </div>
            <PlakaListesi
              daireId={selected.id}
              araclar={araclar}
              onChanged={() => loadDetail(selected.id)}
              canEdit={isYonetici}
            />
            <SahipTarihce daireId={selected.id} />
            {isYonetici && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button variant="secondary" onClick={() => setSahipDegistir(selected)}>
                  Sahip Değiştir
                </Button>
                <Button variant="danger" onClick={() => onDelete(selected.id)}>
                  Daireyi Sil
                </Button>
              </div>
            )}
          </div>
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
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <DocumentArrowUpIcon className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            Toplu İçe Aktar (CSV ; ayraçlı)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Her satıra bir daire gelecek şekilde doldurun</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Kapat</Button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="font-mono text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl p-4 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 focus:border-brand-300"
      />
      <Button onClick={gonder} disabled={busy} loading={busy}>
        {busy ? 'Yükleniyor…' : 'Gönder'}
      </Button>
      {sonuc && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
          <p className="text-green-700 dark:text-green-400 font-medium">✓ Eklenen: {sonuc.eklenenler.length}</p>
          {sonuc.hatalar.length > 0 && (
            <details className="mt-3">
              <summary className="text-red-700 dark:text-red-400 font-medium cursor-pointer flex items-center gap-1">
                <span className="w-5 h-5 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center text-xs">{sonuc.hatalar.length}</span>
                Hatalar
              </summary>
              <ul className="mt-2 ml-7 space-y-1">
                {sonuc.hatalar.map((h, i) => (
                  <li key={i} className="text-sm text-red-600 dark:text-red-400">Satır {h.satir} ({h.daire_no}): {h.hata}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}