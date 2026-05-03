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
      <h1 className="text-2xl font-bold">Audit Log</h1>

      <div className="bg-white rounded-2xl shadow p-3 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm">Tablo</label>
          <select
            value={filt.tablo}
            onChange={(e) => setFilt({ ...filt, tablo: e.target.value })}
            className="min-h-[44px] rounded-lg border border-slate-300 px-3"
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

      <div className="bg-white rounded-2xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3">Zaman</th>
              <th className="p-3">Kullanıcı</th>
              <th className="p-3">Eylem</th>
              <th className="p-3">Tablo</th>
              <th className="p-3">Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3 text-xs whitespace-nowrap">{new Date(r.zaman).toLocaleString('tr-TR')}</td>
                <td className="p-3">{r.kullanici_adi || '—'}</td>
                <td className="p-3">{r.eylem}</td>
                <td className="p-3">{r.tablo_adi}</td>
                <td className="p-3">{r.kayit_id || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
