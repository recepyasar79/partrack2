import { useEffect, useMemo, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { BLOKLAR } from '../utils/constants';
import { toCSV, downloadCSV } from '../utils/csv';

export default function AracListesi() {
  const toast = useToast();
  const [araclar, setAraclar] = useState([]);
  const [q, setQ] = useState('');
  const [blok, setBlok] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  async function load() {
    try {
      const params = {};
      if (q) params.q = q;
      if (blok) params.blok = blok;
      const { data } = await api.get('/araclar', { params });
      setAraclar(data.araclar);
      setPage(1);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  useEffect(() => {
    load();
  }, [q, blok]); // eslint-disable-line react-hooks/exhaustive-deps

  const paged = useMemo(
    () => araclar.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [araclar, page]
  );
  const totalPages = Math.max(1, Math.ceil(araclar.length / PER_PAGE));

  function exportCSV() {
    const csv = toCSV(araclar, [
      { key: 'plaka', label: 'Plaka' },
      { key: 'daire_no', label: 'Daire' },
      { key: 'sahip_ad', label: 'Sahip' },
      { key: 'sahip_tel', label: 'Telefon' },
      { key: 'blok', label: 'Blok' },
    ]);
    const tarih = new Date().toISOString().slice(0, 10);
    downloadCSV(`araclar_${tarih}.csv`, csv);
  }

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Tüm Araç Listesi</h1>
        <div className="flex gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400 self-center">{araclar.length} araç</span>
          <Button variant="secondary" onClick={exportCSV} disabled={!araclar.length}>CSV İndir</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Ara: plaka / daire / sahip"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          containerClassName="flex-1 min-w-[200px]"
        />
        <select
          value={blok}
          onChange={(e) => setBlok(e.target.value)}
          className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
        >
          <option value="">Tüm bloklar</option>
          {BLOKLAR.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 overflow-hidden border border-transparent dark:border-slate-800">
        <table className="w-full text-base">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left">
            <tr>
              <th className="p-3 text-slate-700 dark:text-slate-200">Plaka</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Daire</th>
              <th className="p-3 text-slate-700 dark:text-slate-200 hidden sm:table-cell">Sahip</th>
              <th className="p-3 text-slate-700 dark:text-slate-200 hidden md:table-cell">Telefon</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <td className="p-3 font-mono font-semibold">{a.plaka}</td>
                <td className="p-3 font-mono">{a.daire_no}</td>
                <td className="p-3 hidden sm:table-cell">{a.sahip_ad}</td>
                <td className="p-3 hidden md:table-cell">{a.sahip_tel}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-slate-500 dark:text-slate-400">Araç bulunamadı.</td></tr>
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
