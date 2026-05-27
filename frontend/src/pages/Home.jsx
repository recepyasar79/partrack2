import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../services/api';
import {
  BuildingIcon,
  CarIcon,
  BadgeIcon,
  ChartIcon,
  MoonIcon,
  ArrowRightIcon
} from '../components/ui/Icons';

const cards = [
  {
    to: '/daireler',
    title: 'Daireler',
    desc: 'Daire ve araç tanımlamaları',
    Icon: BuildingIcon,
    gradient: 'from-blue-500 to-blue-600',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    to: '/araclar',
    title: 'Araç Listesi',
    desc: 'Tüm kayıtlı araçlar',
    Icon: CarIcon,
    gradient: 'from-emerald-500 to-emerald-600',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    to: '/misafir-araclar',
    title: 'Misafir Araç',
    desc: 'Geçici muafiyetler',
    Icon: BadgeIcon,
    gradient: 'from-amber-500 to-amber-600',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    to: '/raporlar',
    title: 'Raporlar',
    desc: 'İhlal geçmişi & bildirimler',
    Icon: ChartIcon,
    gradient: 'from-rose-500 to-rose-600',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  {
    to: '/kontrol',
    title: 'Akşam Kontrolü',
    desc: 'Foto yükle, ihlal tespit et',
    Icon: MoonIcon,
    gradient: 'from-purple-500 to-purple-600',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
];

// Tailwind JIT runtime concat'i tanımıyor — accent başına sabit map gerek.
const ACCENT_CLASSES = {
  brand: 'from-brand-50 to-brand-100 dark:from-brand-900/40 dark:to-brand-800/40 border-brand-100 dark:border-brand-800 text-brand-700 dark:text-brand-300',
  accent: 'from-accent-50 to-accent-100 dark:from-accent-900/40 dark:to-accent-800/40 border-accent-100 dark:border-accent-800 text-accent-700 dark:text-accent-300',
  orange: 'from-orange-50 to-orange-100 dark:from-orange-900/40 dark:to-orange-800/40 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
};
const DANGER_CLASSES = 'from-rose-50 to-rose-100 dark:from-rose-900/40 dark:to-rose-800/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300';
const WARN_CLASSES = 'from-amber-50 to-amber-100 dark:from-amber-900/40 dark:to-amber-800/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300';

function UsageStat({ label, current, max, accent }) {
  // max null = sınırsız (kurumsal). Aşan/yakın olunca renk değişir.
  const limitless = max == null;
  const ratio = limitless ? 0 : current / max;
  const danger = !limitless && ratio >= 1;
  const warn = !limitless && ratio >= 0.8 && !danger;
  const color = danger ? DANGER_CLASSES : warn ? WARN_CLASSES : (ACCENT_CLASSES[accent] || ACCENT_CLASSES.brand);
  return (
    <div className={`flex-1 min-w-[100px] bg-gradient-to-br ${color} rounded-xl px-3 py-[5px] border text-center`}>
      <div className="text-xl font-bold tabular-nums leading-tight">
        {current}{limitless ? '' : <span className="text-sm font-medium opacity-70"> / {max}</span>}
      </div>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    // Süperadmin site-usage'a erişemez (platform katmanı); site-bağlı user'lar
    // için yükle. Hata sessizce yutulur — kullanım göstergesi opsiyonel.
    if (!user || user.rol === 'superadmin') return;
    let cancelled = false;
    api.get('/site-usage')
      .then((r) => { if (!cancelled) setUsage(r.data); })
      .catch(() => { /* yoksa kart gizlenir */ });
    return () => { cancelled = true; };
  }, [user?.id]);
  return (
    <div className="p-4 max-w-3xl mx-auto">
      {/* Welcome — kendi satırı; istatistikler altta sola hizalı */}
      <div className="mb-4 flex items-center gap-3 min-w-0">
        <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/25 flex-shrink-0">
          <span className="text-2xl">🅿️</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Hoş geldiniz
          </h1>
          {user?.site?.ad && (
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-300 truncate" title={user.site.ad}>
              {user.site.ad}
            </p>
          )}
        </div>
      </div>

      {usage && (
        <div className="mb-6 flex gap-2">
          <UsageStat label="Daireler" current={usage.daire.current} max={usage.daire.max} accent="accent" />
          <UsageStat label="Araçlar" current={usage.arac?.current || 0} max={usage.arac?.max ?? null} accent="brand" />
          <UsageStat label="Kullanıcılar" current={usage.user.current} max={usage.user.max} accent="orange" />
        </div>
      )}

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card, index) => (
          <Link
            key={card.to}
            to={card.to}
            className="group bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-5 hover:shadow-xl dark:hover:shadow-black/40 hover:-translate-y-1 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start gap-4">
              <div className={`${card.iconBg} ${card.iconColor} dark:bg-opacity-20 w-14 h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 flex-shrink-0`}>
                <card.Icon className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                    {card.title}
                  </h3>
                  <ArrowRightIcon className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-brand-500 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{card.desc}</p>
              </div>
            </div>

            {/* Bottom accent line */}
            <div className={`mt-4 h-1 rounded-full bg-gradient-to-r ${card.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
          </Link>
        ))}
      </div>
    </div>
  );
}