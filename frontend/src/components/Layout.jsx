import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { 
  BuildingIcon, 
  CarIcon, 
  BadgeIcon, 
  CameraIcon, 
  ChartIcon, 
  UsersIcon, 
  ShieldIcon,
  LockClosedIcon,
  ArrowRightIcon
} from './ui/Icons';

const navItems = [
  { to: '/daireler', label: 'Daireler', Icon: BuildingIcon },
  { to: '/araclar', label: 'Araçlar', Icon: CarIcon },
  { to: '/misafir-araclar', label: 'Misafir', Icon: BadgeIcon },
  { to: '/kontrol', label: 'Kontrol', Icon: CameraIcon },
  { to: '/raporlar', label: 'Rapor', Icon: ChartIcon },
];

const adminItems = [
  { to: '/kullanicilar', label: 'Kullanıcılar', Icon: UsersIcon },
  { to: '/audit', label: 'Audit Log', Icon: ShieldIcon },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const isYonetici = user?.rol === 'yonetici';

  return (
    <div className="min-h-full pb-20 bg-slate-50">
      <header className="bg-gradient-to-r from-brand-900 to-brand-800 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-20 shadow-lg">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm">
            <span className="text-lg">🅿️</span>
          </div>
          <span className="font-bold text-xl tracking-tight">ParkTrack</span>
        </Link>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:flex items-center gap-2 text-white/80">
              <div className="w-8 h-8 bg-brand-600 rounded-full flex items-center justify-center text-xs font-semibold">
                {user.kullanici_adi?.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-white">{user.kullanici_adi}</span>
                <span className="text-xs text-white/60">
                  {user.rol === 'yonetici' ? 'Yönetici' : 'Güvenlik'}
                </span>
              </div>
            </span>
            {isYonetici && (
              <div className="hidden md:flex gap-1">
                {adminItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-all ${
                        isActive 
                          ? 'bg-white/20 text-white' 
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`
                    }
                  >
                    <item.Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 border-l border-white/20 pl-3">
              <Link 
                to="/sifre-degistir" 
                className="text-xs text-white/70 hover:text-white transition-colors flex items-center gap-1"
              >
                <LockClosedIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Şifre</span>
              </Link>
              <button 
                onClick={logout} 
                className="text-xs text-white/70 hover:text-white transition-colors"
              >
                Çıkış
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="animate-fade-in">{children}</main>

      {user && (
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgb(0_0_0_/_0.1)] z-20">
          <div className="max-w-3xl mx-auto flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2.5 min-h-[60px] transition-all ${
                    isActive 
                      ? 'text-brand-600 bg-brand-50' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`relative ${isActive ? 'scale-110' : ''} transition-transform`}>
                      <item.Icon 
                        className={`w-6 h-6 ${isActive ? 'text-brand-600' : ''}`} 
                      />
                      {isActive && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-brand-600 rounded-full" />
                      )}
                    </div>
                    <span className={`text-[11px] mt-1 font-medium ${isActive ? 'font-semibold' : ''}`}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}