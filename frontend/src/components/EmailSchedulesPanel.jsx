import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { useAuth } from '../auth/AuthContext';

const FREQ_LABEL = { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık' };

export default function EmailSchedulesPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', frequency: 'weekly' });
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.rol === 'site_yonetici';

  async function load() {
    try {
      const { data } = await api.get('/raporlar/schedules');
      setList(data.schedules || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function addSchedule(e) {
    e.preventDefault();
    if (!form.email) return toast.warning('Email zorunlu.');
    setBusy(true);
    try {
      await api.post('/raporlar/schedules', form);
      toast.success('Email aboneliği eklendi.');
      setForm({ email: '', frequency: 'weekly' });
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  }

  async function toggle(s) {
    setBusy(true);
    try {
      await api.put(`/raporlar/schedules/${s.id}`, { enabled: !s.enabled });
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  }

  async function remove(s) {
    if (!confirm(`${s.email} aboneliğini silmek istediğinizden emin misiniz?`)) return;
    setBusy(true);
    try {
      await api.delete(`/raporlar/schedules/${s.id}`);
      toast.success('Abonelik silindi.');
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">Otomatik Email Raporu</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Belirttiğiniz e-postaya günlük/haftalık/aylık özet rapor otomatik gönderilir.
          Haftalık raporlar Pazartesi, aylık raporlar ayın 1'inde iletilir (Türkiye saati).
        </p>

        {isAdmin ? (
          <form onSubmit={addSchedule} className="flex flex-wrap gap-3 items-end">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ornek@site.com"
              required
              className="flex-1 min-w-[200px]"
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700 dark:text-slate-200">Sıklık</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
              >
                <option value="daily">Günlük</option>
                <option value="weekly">Haftalık</option>
                <option value="monthly">Aylık</option>
              </select>
            </div>
            <Button type="submit" disabled={busy}>Ekle</Button>
          </form>
        ) : (
          <p className="text-xs text-slate-400">Email aboneliği yönetimi yalnızca site yöneticilerine açıktır.</p>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 overflow-x-auto">
        <table className="w-full text-base">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Sıklık</th>
              <th className="p-3">Durum</th>
              <th className="p-3 hidden md:table-cell">Son Gönderim</th>
              {isAdmin && <th className="p-3 w-32">İşlem</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Yükleniyor…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
            ) : list.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <td className="p-3 break-all">{s.email}</td>
                <td className="p-3">{FREQ_LABEL[s.frequency] || s.frequency}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    s.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {s.enabled ? 'Aktif' : 'Pasif'}
                  </span>
                </td>
                <td className="p-3 hidden md:table-cell text-xs text-slate-500">
                  {s.last_sent_at ? new Date(s.last_sent_at).toLocaleString('tr-TR') : '—'}
                </td>
                {isAdmin && (
                  <td className="p-3 flex gap-2">
                    <button
                      onClick={() => toggle(s)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      {s.enabled ? 'Durdur' : 'Başlat'}
                    </button>
                    <button
                      onClick={() => remove(s)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200"
                    >
                      Sil
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
