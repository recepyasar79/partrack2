import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { 
  BuildingIcon, 
  CarIcon, 
  BadgeIcon, 
  CameraIcon, 
  ChartIcon,
  ArrowRightIcon 
} from '../components/ui/Icons';

const cards = [
  { 
    to: '/daireler', 
    title: 'Daireler', 
    desc: 'Daire ve araç tanımlamaları',
    Icon: BuildingIcon,
    gradient: 'from-blue-500 to-blue-600',
    bgLight: 'bg-blue-50',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600'
  },
  { 
    to: '/araclar', 
    title: 'Araç Listesi', 
    desc: 'Tüm kayıtlı araçlar',
    Icon: CarIcon,
    gradient: 'from-emerald-500 to-emerald-600',
    bgLight: 'bg-emerald-50',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600'
  },
  { 
    to: '/misafir-araclar', 
    title: 'Misafir Araç', 
    desc: 'Geçici muafiyetler',
    Icon: BadgeIcon,
    gradient: 'from-amber-500 to-amber-600',
    bgLight: 'bg-amber-50',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600'
  },
  { 
    to: '/kontrol', 
    title: 'Akşam Kontrolü', 
    desc: 'Foto yükle, ihlal tespit et',
    Icon: CameraIcon,
    gradient: 'from-purple-500 to-purple-600',
    bgLight: 'bg-purple-50',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600'
  },
  { 
    to: '/raporlar', 
    title: 'Raporlar', 
    desc: 'İhlal geçmişi & bildirimler',
    Icon: ChartIcon,
    gradient: 'from-rose-500 to-rose-600',
    bgLight: 'bg-rose-50',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600'
  },
];

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="p-4 max-w-3xl mx-auto">
      {/* Welcome Section */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/25">
            <span className="text-2xl">🅿️</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Hoş geldiniz
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {user?.kullanici_adi} · {user?.rol === 'superadmin' ? 'Platform Yöneticisi' : user?.rol === 'site_yonetici' ? 'Site Yöneticisi' : 'Güvenlik'}
            </p>
          </div>
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Site otopark yönetim sistemine hoş geldiniz. Yukarıdaki kartlardan işlem yapabilirsiniz.
        </p>
      </div>

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
              <div className={`${card.iconBg} ${card.iconColor} dark:bg-opacity-20 w-14 h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
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

      {/* Info Cards */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-900/40 dark:to-brand-800/40 rounded-xl p-4 border border-brand-100 dark:border-brand-800">
          <div className="text-2xl font-bold text-brand-700 dark:text-brand-300">136</div>
          <div className="text-xs text-brand-600 dark:text-brand-400">Toplam Daire</div>
        </div>
        <div className="bg-gradient-to-br from-accent-50 to-accent-100 dark:from-accent-900/40 dark:to-accent-800/40 rounded-xl p-4 border border-accent-100 dark:border-accent-800">
          <div className="text-2xl font-bold text-accent-700 dark:text-accent-300">4</div>
          <div className="text-xs text-accent-600 dark:text-accent-400">Blok Sayısı</div>
        </div>
      </div>
    </div>
  );
}