import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';
import { useTheme } from '../theme/ThemeContext';

function StatCard({ label, value, sub, color = 'brand' }) {
  const colors = {
    brand: 'from-brand-500 to-brand-600',
    rose: 'from-rose-500 to-rose-600',
    amber: 'from-amber-500 to-amber-600',
    emerald: 'from-emerald-500 to-emerald-600',
    purple: 'from-purple-500 to-purple-600',
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-slate-100 dark:border-slate-800 p-4">
      <div className={`text-xs uppercase tracking-wide bg-gradient-to-r ${colors[color] || colors.brand} bg-clip-text text-transparent font-semibold`}>
        {label}
      </div>
      <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</div>
      )}
    </div>
  );
}

export default function RaporlarDashboard({ baslangic, bitis }) {
  const toast = useToast();
  const { isDark } = useTheme();
  const dark = isDark;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/raporlar/dashboard', { params: { baslangic, bitis } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) toast.error(apiError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [baslangic, bitis]); // eslint-disable-line

  if (loading && !data) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Yükleniyor…</div>;
  }
  if (!data) return null;

  const axis = dark ? '#94a3b8' : '#475569';
  const grid = dark ? '#1e293b' : '#e2e8f0';
  const tipBg = dark ? '#0f172a' : '#ffffff';
  const tipBorder = dark ? '#334155' : '#cbd5e1';

  return (
    <div className="flex flex-col gap-4">
      {/* Stat kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Toplam İhlal"
          value={data.ozet.toplam_ihlal}
          sub={`${data.ozet.coklu_arac} çoklu · ${data.ozet.kayitsiz} kayıtsız`}
          color="rose"
        />
        <StatCard
          label="Etkilenen Daire"
          value={data.ozet.etkilenen_daire}
          sub="benzersiz daire"
          color="amber"
        />
        <StatCard
          label="Kontrol Günü"
          value={data.ozet.kontrol_yapilan_gun}
          sub="foto yüklenen gün"
          color="brand"
        />
        <StatCard
          label="Bildirim Başarı"
          value={`%${data.bildirim.basari_orani}`}
          sub={`${data.bildirim.gonderildi}/${data.bildirim.toplam} gönderildi`}
          color={data.bildirim.basari_orani >= 80 ? 'emerald' : 'amber'}
        />
      </div>

      {/* Günlük trend (line) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-slate-100 dark:border-slate-800 p-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Günlük İhlal Trendi</h3>
        {data.gunluk_trend.length === 0 ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm">
            Bu aralıkta veri yok.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.gunluk_trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} />
              <XAxis dataKey="tarih" stroke={axis} tick={{ fontSize: 11 }} />
              <YAxis stroke={axis} tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: tipBg, border: `1px solid ${tipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: axis }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="coklu_arac" name="Çoklu Araç" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="kayitsiz" name="Kayıtsız" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Aylık trend + Blok dağılım yan yana */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-slate-100 dark:border-slate-800 p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">Aylık Trend (son 12 ay)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Üst seçili dönem aralığından bağımsız.</p>
          {data.aylik_trend.length === 0 ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm">Veri yok.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.aylik_trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis dataKey="ay" stroke={axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: tipBg, border: `1px solid ${tipBorder}`, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="coklu_arac" name="Çoklu Araç" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="kayitsiz" name="Kayıtsız" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-slate-100 dark:border-slate-800 p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Blok Dağılımı</h3>
          {data.blok_dagilim.length === 0 ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm">Veri yok.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.blok_dagilim} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis dataKey="blok" stroke={axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: tipBg, border: `1px solid ${tipBorder}`, borderRadius: 8 }} />
                <Bar dataKey="ihlal" name="İhlal" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top 10 daire tablosu */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-slate-100 dark:border-slate-800 overflow-x-auto">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 p-4 pb-2">En Çok İhlal Yapan Daireler (Top 10)</h3>
        {data.top_daireler.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">Veri yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Daire</th>
                <th className="p-3 hidden sm:table-cell">Sahip</th>
                <th className="p-3">İhlal</th>
                <th className="p-3 hidden md:table-cell">Son İhlal</th>
              </tr>
            </thead>
            <tbody>
              {data.top_daireler.map((d, i) => (
                <tr key={d.daire_no} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                  <td className="p-3 text-slate-500">{i + 1}</td>
                  <td className="p-3 font-mono font-semibold">{d.daire_no}</td>
                  <td className="p-3 hidden sm:table-cell">{d.sahip_ad || '—'}</td>
                  <td className="p-3 font-bold">{d.ihlal_sayisi}</td>
                  <td className="p-3 hidden md:table-cell text-xs text-slate-500">
                    {d.son_ihlal ? String(d.son_ihlal).slice(0, 10) : '—'}
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
