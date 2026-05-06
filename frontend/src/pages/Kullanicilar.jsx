import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export default function Kullanicilar() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ kullanici_adi: '', sifre: '', rol: 'guvenlik' });
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetSifre, setResetSifre] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/auth/kullanicilar');
      setList(data.kullanicilar);
    } catch (e) {
      toast.error(apiError(e));
    }
  }
  useEffect(() => { load(); }, []);

  async function ekle() {
    if (!form.kullanici_adi || form.sifre.length < 8) {
      return toast.error('Kullanıcı adı zorunlu, şifre en az 8 karakter.');
    }
    setBusy(true);
    try {
      await api.post('/auth/register', form);
      toast.success('Kullanıcı eklendi.');
      setForm({ kullanici_adi: '', sifre: '', rol: 'guvenlik' });
      setShowForm(false);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  async function setAktif(id, aktif) {
    try {
      await api.patch(`/auth/kullanicilar/${id}`, { aktif });
      toast.success(aktif ? 'Aktif edildi.' : 'Deaktif edildi.');
      load();
    } catch (e) { toast.error(apiError(e)); }
  }

  async function sifreSifirla() {
    if (resetSifre.length < 8) return toast.error('Şifre en az 8 karakter.');
    try {
      await api.post('/auth/sifre-sifirla', {
        kullanici_id: resetTarget.id,
        yeni_sifre: resetSifre,
      });
      toast.success(`${resetTarget.kullanici_adi} şifresi sıfırlandı.`);
      setResetTarget(null);
      setResetSifre('');
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Kullanıcılar</h1>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Kapat' : '+ Yeni'}</Button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
          <Input
            label="Kullanıcı adı"
            value={form.kullanici_adi}
            onChange={(e) => setForm({ ...form, kullanici_adi: e.target.value })}
          />
          <Input
            label="Şifre (en az 8 karakter)"
            type="password"
            value={form.sifre}
            onChange={(e) => setForm({ ...form, sifre: e.target.value })}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Rol</label>
            <select
              value={form.rol}
              onChange={(e) => setForm({ ...form, rol: e.target.value })}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3"
            >
              <option value="guvenlik">Güvenlik</option>
              <option value="yonetici">Yönetici</option>
            </select>
          </div>
          <Button onClick={ekle} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="w-full text-base">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3">Kullanıcı</th>
              <th className="p-3">Rol</th>
              <th className="p-3 hidden sm:table-cell">Son giriş</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${!u.aktif ? 'opacity-50' : ''}`}>
                <td className="p-3 font-medium">{u.kullanici_adi}</td>
                <td className="p-3">{u.rol === 'yonetici' ? 'Yönetici' : 'Güvenlik'}</td>
                <td className="p-3 hidden sm:table-cell text-slate-600 text-xs">
                  {u.son_giris ? new Date(u.son_giris).toLocaleString('tr-TR') : '—'}
                </td>
                <td className="p-3 text-right flex flex-wrap gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)}>Şifre Sıfırla</Button>
                  <Button size="sm" variant={u.aktif ? 'danger' : 'secondary'} onClick={() => setAktif(u.id, !u.aktif)}>
                    {u.aktif ? 'Deaktif Et' : 'Aktif Et'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-3">
            <h2 className="text-lg font-bold">{resetTarget.kullanici_adi} — Şifre Sıfırla</h2>
            <Input label="Yeni şifre" type="password" value={resetSifre} onChange={(e) => setResetSifre(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => { setResetTarget(null); setResetSifre(''); }}>İptal</Button>
              <Button onClick={sifreSifirla}>Kaydet</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
