import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  BuildingIcon,
  CarIcon,
  BadgeIcon,
  CameraIcon,
  ChartIcon,
  UsersIcon,
  ShieldIcon,
  LockClosedIcon,
  LogoutIcon,
  SunIcon,
  MoonIcon
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

// Sadece superadmin (platform sahibi) için ek menü.
// OCR İstatistik platform metriği — site_yonetici görmez.
const superadminItems = [
  { to: '/sites', label: 'Siteler', Icon: BuildingIcon },
  { to: '/ocr-istatistik', label: 'OCR İstatistik', Icon: ChartIcon },
];

const ROL_LABEL = {
  superadmin: 'Platform Yöneticisi',
  site_yonetici: 'Site Yöneticisi',
  guvenlik: 'Güvenlik',
};

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
      title={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors"
    >
      {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
    </button>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const isSiteAdmin = user?.rol === 'site_yonetici';
  const isSuperadmin = user?.rol === 'superadmin';

  return (
    <div className="min-h-full pb-20 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <header className="bg-gradient-to-r from-brand-900 to-brand-800 dark:from-slate-900 dark:to-slate-800 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-20 shadow-lg">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm flex-shrink-0">
            <span className="text-lg">🅿️</span>
          </div>
          <span className="font-bold text-xl tracking-tight flex-shrink-0">ParkTrack</span>
          {user?.site?.ad && (
            <span className="hidden sm:flex items-center gap-2 min-w-0">
              <span className="text-white/40" aria-hidden="true">·</span>
              <span className="text-sm font-medium text-white/90 truncate" title={user.site.ad}>
                {user.site.ad}
              </span>
            </span>
          )}
        </Link>
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:flex items-center gap-2 text-white/80">
              <div className="w-8 h-8 bg-brand-600 rounded-full flex items-center justify-center text-xs font-semibold">
                {user.kullanici_adi?.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-white">{user.kullanici_adi}</span>
                <span className="text-xs text-white/60">
                  {ROL_LABEL[user.rol] || user.rol}
                </span>
              </div>
            </span>
            {(isSiteAdmin || isSuperadmin) && (
              <span aria-hidden="true" className="hidden md:block w-px bg-white/20 self-stretch" />
            )}
            {(isSiteAdmin || isSuperadmin) && (
              <div className="hidden md:flex gap-1">
                {(isSuperadmin ? superadminItems : adminItems).map((item) => (
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
              <ThemeToggle />
              <Link
                to="/sifre-degistir"
                className="text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 px-2 py-2 rounded-lg"
              >
                <LockClosedIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Şifre</span>
              </Link>
              <span aria-hidden="true" className="w-px bg-white/20 self-stretch" />
              <button
                onClick={logout}
                className="text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors px-2 py-2 rounded-lg flex items-center gap-1"
              >
                <LogoutIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Çıkış</span>
              </button>
            </div>
          </div>
        ) : (
          <ThemeToggle />
        )}
      </header>

      <main className="animate-fade-in">{children}</main>

      {user && !isSuperadmin && (
        <nav className="fixed bottom-0 inset-x-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[0_-4px_6px_-1px_rgb(0_0_0_/_0.1)] z-20">
          <div className="max-w-3xl mx-auto flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2.5 min-h-[60px] transition-all ${
                    isActive
                      ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`relative ${isActive ? 'scale-110' : ''} transition-transform`}>
                      <item.Icon
                        className={`w-6 h-6 ${isActive ? 'text-brand-600 dark:text-brand-400' : ''}`}
                      />
                      {isActive && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-brand-600 dark:bg-brand-400 rounded-full" />
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
