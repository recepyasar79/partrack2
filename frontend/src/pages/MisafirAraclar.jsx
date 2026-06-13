import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { isValidPlakaSerbest, normalizePlaka } from '../utils/validation';
import { bugunStr, icerideMi } from '../utils/misafir';

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTarihSaat(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MisafirAraclar() {
  const toast = useToast();
  const { user } = useAuth();
  const isYonetici = user?.rol === 'site_yonetici' || user?.rol === 'superadmin';
  const [list, setList] = useState([]);
  const [daireler, setDaireler] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    daire_id: '',
    plaka: '',
    baslangic_tarihi: nowLocal(),
    bitis_tarihi: nowLocal(),
    aciklama: '',
  });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

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

  // Seçili daireye daha önce gelmiş araçların benzersiz plakaları — kayıtlı
  // misafir geçmişinden türetilir (backend'den ayrı istek gerekmez, list
  // zaten sitenin tüm misafir kayıtlarını içerir).
  const gecmisPlakalar = useMemo(() => {
    if (!form.daire_id) return [];
    const seen = new Set();
    const out = [];
    for (const m of list) {
      if (String(m.daire_id) !== String(form.daire_id)) continue;
      if (seen.has(m.plaka)) continue;
      seen.add(m.plaka);
      out.push(m);
    }
    return out;
  }, [form.daire_id, list]);

  const bugun = useMemo(() => bugunStr(), []);

  // Arama + "içeridekiler üstte" sıralaması. Aktif misafirler listenin
  // başına alınır; aralarına render'da bir ayraç konur.
  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr');
    const base = !s
      ? list
      : list.filter((m) =>
          [m.plaka, m.daire_no, m.sahip_ad, m.aciklama].some(
            (v) => (v || '').toString().toLocaleLowerCase('tr').includes(s)
          )
        );
    // Array.prototype.sort stabildir → grup içi mevcut sıra (baslangic desc) korunur.
    return [...base].sort((a, b) => Number(icerideMi(b, bugun)) - Number(icerideMi(a, bugun)));
  }, [list, q, bugun]);

  const icerideSayisi = useMemo(
    () => filtered.reduce((n, m) => n + (icerideMi(m, bugun) ? 1 : 0), 0),
    [filtered, bugun]
  );

  const paged = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  useEffect(() => { setPage(1); }, [q]);

  // Plakaya tıklayınca form plaka alanına yaz + panoya kopyala (hızlı kayıt).
  function secPlaka(plaka) {
    setForm((f) => ({ ...f, plaka }));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(plaka).catch(() => { /* pano erişimi yoksa yoksay */ });
    }
    toast.success(`${plaka} plaka alanına yazıldı`);
  }

  async function gonder() {
    const p = normalizePlaka(form.plaka);
    if (!form.daire_id) return toast.error('Daire seçin.');
    if (!isValidPlakaSerbest(p)) return toast.error('Plaka formatı geçersiz.');
    setBusy(true);
    try {
      await api.post('/misafir-araclar', { ...form, plaka: p });
      toast.success('Misafir araç eklendi.');
      setShowForm(false);
      setForm({
        daire_id: '',
        plaka: '',
        baslangic_tarihi: nowLocal(),
        bitis_tarihi: nowLocal(),
        aciklama: '',
      });
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Misafir Araçlar</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Kapat' : '+ Yeni'}</Button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Daire</label>
            <select
              value={form.daire_id}
              onChange={(e) => setForm({ ...form, daire_id: e.target.value })}
              className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
            >
              <option value="">Daire seçin…</option>
              {daireler.map((d) => (
                <option key={d.id} value={d.id}>{d.daire_no} — {d.sahip_ad}</option>
              ))}
            </select>
          </div>
          <Input label="Plaka" value={form.plaka} onChange={(e) => setForm({ ...form, plaka: e.target.value.toUpperCase() })} />

          {form.daire_id && (
            <div className="flex flex-col gap-1.5 -mt-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Bu daireye daha önce gelen araçlar
                {gecmisPlakalar.length > 0 && ` (${gecmisPlakalar.length})`}
                {gecmisPlakalar.length > 0 && ' — hızlı kayıt için tıkla'}
              </span>
              {gecmisPlakalar.length === 0 ? (
                <span className="text-sm text-slate-400 dark:text-slate-500">Kayıt yok.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {gecmisPlakalar.map((m) => {
                    const secili = m.plaka === form.plaka;
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => secPlaka(m.plaka)}
                        title="Plaka alanına yaz + panoya kopyala"
                        className={`font-mono text-sm px-2.5 py-1 rounded-lg border transition-colors ${
                          secili
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200 dark:border-brand-600'
                            : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {m.plaka}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label="Başlangıç (tarih + saat)"
              type="datetime-local"
              value={form.baslangic_tarihi}
              onChange={(e) => setForm({ ...form, baslangic_tarihi: e.target.value })}
            />
            <Input
              label="Bitiş (tarih + saat)"
              type="datetime-local"
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Ara: plaka / daire / adı soyadı / açıklama"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          containerClassName="flex-1 min-w-[200px]"
        />
        <span className="inline-flex items-center gap-1 text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-0.5">
          {filtered.length} kayıt
        </span>
        {icerideSayisi > 0 && (
          <span className="inline-flex items-center gap-1 text-sm font-medium bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full px-2.5 py-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Şu an içeride: {icerideSayisi}
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 overflow-hidden border border-transparent dark:border-slate-800">
        <table className="w-full text-base">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left">
            <tr>
              <th className="p-3 text-slate-700 dark:text-slate-200">Plaka</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Daire</th>
              <th className="p-3 text-slate-700 dark:text-slate-200 hidden sm:table-cell">Tarih</th>
              <th className="p-3 text-slate-700 dark:text-slate-200 hidden md:table-cell">Açıklama</th>
              {isYonetici && <th className="p-3"></th>}
            </tr>
          </thead>
          <tbody>
            {paged.map((m, i) => {
              const globalIndex = (page - 1) * PER_PAGE + i;
              const iceride = icerideMi(m, bugun);
              // Aktif (içeride) grup ile geçmiş kayıtlar arasına ayraç:
              // global index aktif sayısına eşitse bu, ilk geçmiş kayıttır.
              const ayrac = icerideSayisi > 0 && globalIndex === icerideSayisi;
              const colSpan = isYonetici ? 5 : 4;
              return (
                <Fragment key={m.id}>
                  {ayrac && (
                    <tr>
                      <td colSpan={colSpan} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
                        Geçmiş kayıtlar
                      </td>
                    </tr>
                  )}
                  <tr
                    className={`border-t text-slate-800 dark:text-slate-200 ${
                      iceride
                        ? 'border-l-4 border-l-emerald-500 border-t-slate-100 dark:border-t-slate-800 bg-emerald-50/60 dark:bg-emerald-900/20'
                        : 'border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    <td className="p-3 font-mono">
                      <span className="inline-flex items-center gap-2">
                        {m.plaka}
                        {iceride && (
                          <span className="font-sans text-[11px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded px-1.5 py-0.5">
                            İçeride
                          </span>
                        )}
                      </span>
                      {/* Mobilde Tarih kolonu gizli (sm altı) — burada satır içi göster */}
                      <span className="sm:hidden block font-sans text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {formatTarihSaat(m.baslangic_tarihi)} → {formatTarihSaat(m.bitis_tarihi)}
                      </span>
                      {/* Mobil + küçük tablette Açıklama kolonu gizli (md altı) — satır içi göster */}
                      {m.aciklama && (
                        <span className="md:hidden block font-sans text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {m.aciklama}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">{m.daire_no}</td>
                    <td className="p-3 hidden sm:table-cell text-sm">{formatTarihSaat(m.baslangic_tarihi)} → {formatTarihSaat(m.bitis_tarihi)}</td>
                    <td className="p-3 hidden md:table-cell text-slate-600 dark:text-slate-400">{m.aciklama}</td>
                    {isYonetici && (
                      <td className="p-3 text-right">
                        <Button size="sm" variant="danger" onClick={() => sil(m.id)}>Sil</Button>
                      </td>
                    )}
                  </tr>
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={isYonetici ? 5 : 4} className="p-6 text-center text-slate-500 dark:text-slate-400">
                {q ? 'Arama sonucu bulunamadı.' : 'Misafir kayıt yok.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 border-t border-slate-100 dark:border-slate-800">
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ Önceki</Button>
            <span className="text-sm py-2 text-slate-600 dark:text-slate-300">{page} / {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Sonraki ›</Button>
          </div>
        )}
      </div>
    </div>
  );
}
