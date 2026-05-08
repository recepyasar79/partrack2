import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export default function AuditLog() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [filt, setFilt] = useState({ tablo: '', baslangic: '', bitis: '' });

  async function load() {
    try {
      const params = {};
      if (filt.tablo) params.tablo = filt.tablo;
      if (filt.baslangic) params.baslangic = filt.baslangic;
      if (filt.bitis) params.bitis = filt.bitis;
      const { data } = await api.get('/audit-log', { params });
      setList(data.kayitlar);
    } catch (e) { toast.error(apiError(e)); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Audit Log</h1>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-3 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-700 dark:text-slate-200">Tablo</label>
          <select
            value={filt.tablo}
            onChange={(e) => setFilt({ ...filt, tablo: e.target.value })}
            className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
          >
            <option value="">Tümü</option>
            <option value="users">users</option>
            <option value="daireler">daireler</option>
            <option value="araclar">araclar</option>
            <option value="misafir_araclar">misafir_araclar</option>
          </select>
        </div>
        <Input
          label="Başlangıç"
          type="date"
          value={filt.baslangic}
          onChange={(e) => setFilt({ ...filt, baslangic: e.target.value })}
        />
        <Input
          label="Bitiş"
          type="date"
          value={filt.bitis}
          onChange={(e) => setFilt({ ...filt, bitis: e.target.value })}
        />
        <Button onClick={load}>Filtrele</Button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 overflow-x-auto border border-transparent dark:border-slate-800">
        <table className="w-full text-base">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left">
            <tr>
              <th className="p-3 text-slate-700 dark:text-slate-200">Zaman</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Kullanıcı</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Eylem</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Tablo</th>
              <th className="p-3 text-slate-700 dark:text-slate-200">Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <td className="p-3 text-xs whitespace-nowrap">{new Date(r.zaman).toLocaleString('tr-TR')}</td>
                <td className="p-3">{r.kullanici_adi || '—'}</td>
                <td className="p-3">{r.eylem}</td>
                <td className="p-3">{r.tablo_adi}</td>
                <td className="p-3">{r.kayit_id || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
