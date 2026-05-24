import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import {
  BuildingIcon,
  PlusIcon,
  UsersIcon,
  ChartIcon,
  CameraIcon,
  XMarkIcon,
} from '../components/ui/Icons';

const PLAN_LABELS = {
  baslangic: 'Başlangıç',
  standart: 'Standart',
  pro: 'Pro',
  kurumsal: 'Kurumsal',
};

function NewSiteForm({ onCreated, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState({ ad: '', slug: '', plan: 'baslangic' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.ad || !form.slug) {
      return toast.error('Site adı ve slug zorunlu.');
    }
    setBusy(true);
    try {
      const { data } = await api.post('/sites', form);
      toast.success(`${data.site.ad} oluşturuldu.`);
      onCreated(data.site);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Yeni Site</h3>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Input
          label="Site Adı"
          placeholder="Akasya Evleri"
          value={form.ad}
          onChange={(e) => setForm({ ...form, ad: e.target.value })}
          required
        />
        <Input
          label="Slug"
          placeholder="akasya-evleri"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
          helper="URL-safe: küçük harf, rakam, tire"
          required
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Plan</label>
          <select
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
            className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
          >
            {Object.entries(PLAN_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>İptal</Button>
        <Button onClick={submit} disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Oluştur'}</Button>
      </div>
    </div>
  );
}

function SiteDetail({ siteId, onClose, onChanged }) {
  const toast = useToast();
  const [detay, setDetay] = useState(null);
  const [users, setUsers] = useState([]);
  const [userForm, setUserForm] = useState({ kullanici_adi: '', sifre: '', rol: 'site_yonetici' });
  const [showUserForm, setShowUserForm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [d, u] = await Promise.all([
        api.get(`/sites/${siteId}`),
        api.get(`/sites/${siteId}/users`),
      ]);
      setDetay(d.data);
      setUsers(u.data.users);
    } catch (e) {
      toast.error(apiError(e));
    }
  }
  useEffect(() => { load(); }, [siteId]); // eslint-disable-line

  async function addUser() {
    if (!userForm.kullanici_adi || userForm.sifre.length < 8) {
      return toast.error('Kullanıcı adı zorunlu, şifre en az 8 karakter.');
    }
    setBusy(true);
    try {
      await api.post(`/sites/${siteId}/users`, userForm);
      toast.success('Kullanıcı eklendi.');
      setUserForm({ kullanici_adi: '', sifre: '', rol: 'site_yonetici' });
      setShowUserForm(false);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detay) return <div className="p-4 text-slate-500">Yükleniyor…</div>;

  const { site, metrikler } = detay;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{site.ad}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <code>{site.slug}</code> · {PLAN_LABELS[site.plan] || site.plan} ·{' '}
            <span className={site.aktif ? 'text-green-600' : 'text-red-600'}>
              {site.aktif ? 'Aktif' : 'Pasif'}
            </span>
          </p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Metric Icon={BuildingIcon} label="Daire" value={metrikler.daire_sayisi} />
        <Metric Icon={UsersIcon} label="Kullanıcı" value={metrikler.user_sayisi} />
        <Metric Icon={ChartIcon} label="Araç" value={metrikler.arac_sayisi} />
        <Metric Icon={CameraIcon} label="Foto (30g)" value={metrikler.son_30_gun.foto_upload} />
        <Metric Icon={ChartIcon} label="OCR (30g)" value={metrikler.son_30_gun.ocr_cagrisi} />
        <Metric Icon={ChartIcon} label="Plate Recognizer (30g)" value={metrikler.son_30_gun.plate_recognizer_cagrisi} />
      </div>

      <div className="p-4 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">Kullanıcılar</h3>
          <Button size="sm" onClick={() => setShowUserForm((s) => !s)}>
            {showUserForm ? 'İptal' : 'Kullanıcı Ekle'}
          </Button>
        </div>

        {showUserForm && (
          <div className="mb-4 grid sm:grid-cols-4 gap-2 items-end">
            <Input
              label="Kullanıcı adı"
              value={userForm.kullanici_adi}
              onChange={(e) => setUserForm({ ...userForm, kullanici_adi: e.target.value })}
            />
            <Input
              label="Şifre"
              type="password"
              value={userForm.sifre}
              onChange={(e) => setUserForm({ ...userForm, sifre: e.target.value })}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Rol</label>
              <select
                value={userForm.rol}
                onChange={(e) => setUserForm({ ...userForm, rol: e.target.value })}
                className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3"
              >
                <option value="site_yonetici">Site Yöneticisi</option>
                <option value="guvenlik">Güvenlik</option>
              </select>
            </div>
            <Button onClick={addUser} disabled={busy}>{busy ? 'Ekleniyor…' : 'Ekle'}</Button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-2">Kullanıcı</th>
              <th className="py-2">Rol</th>
              <th className="py-2">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{u.kullanici_adi}</td>
                <td className="py-2 text-slate-600 dark:text-slate-400">
                  {u.rol === 'site_yonetici' ? 'Yönetici' : 'Güvenlik'}
                </td>
                <td className={`py-2 ${u.aktif ? 'text-green-600' : 'text-red-600'}`}>
                  {u.aktif ? 'Aktif' : 'Pasif'}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="py-3 text-center text-slate-500">Kullanıcı yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
      <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-700 dark:text-brand-300">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export default function SuperadminSiteler() {
  const toast = useToast();
  const [siteler, setSiteler] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/sites');
      setSiteler(data.siteler);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Site Yönetimi</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Platform üzerindeki tüm siteleri burada yönet. Her site izole — bir sitenin verisi diğerine sızmaz.
          </p>
        </div>
        <Button onClick={() => setShowNew((s) => !s)}>
          <PlusIcon className="w-4 h-4 mr-1" />
          {showNew ? 'İptal' : 'Yeni Site'}
        </Button>
      </div>

      {showNew && (
        <NewSiteForm
          onCreated={(s) => { setShowNew(false); load(); setSelectedId(s.id); }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {selectedId && (
        <SiteDetail
          siteId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-slate-500">Yükleniyor…</div>
        ) : siteler.length === 0 ? (
          <div className="p-6 text-center text-slate-500">Site yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-600 dark:text-slate-300">
              <tr>
                <th className="p-3">Site</th>
                <th className="p-3">Slug</th>
                <th className="p-3 text-right">Daire</th>
                <th className="p-3 text-right">Kullanıcı</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {siteler.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="cursor-pointer hover:bg-brand-50 dark:hover:bg-slate-800/40"
                >
                  <td className="p-3 font-medium text-slate-900 dark:text-slate-100">{s.ad}</td>
                  <td className="p-3 font-mono text-xs text-slate-600 dark:text-slate-400">{s.slug}</td>
                  <td className="p-3 text-right tabular-nums">{s.daire_sayisi}</td>
                  <td className="p-3 text-right tabular-nums">{s.user_sayisi}</td>
                  <td className="p-3">{PLAN_LABELS[s.plan] || s.plan}</td>
                  <td className={`p-3 ${s.aktif ? 'text-green-700' : 'text-red-700'}`}>
                    {s.aktif ? 'Aktif' : 'Pasif'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
