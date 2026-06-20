import { useState, useEffect, useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { api } from '../services/api';
import NumaralarModal from './NumaralarModal';
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
  MoonIcon,
  CreditCardIcon,
  CogIcon,
  ChevronDownIcon,
  PhoneIcon,
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
  { to: '/abonelik', label: 'Abonelik', Icon: CreditCardIcon },
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

// Header kutucuğu: Park Yeri Sayısı / İçerideki Araç Sayısı.
// Site'nin toplam park kapasitesi user.site'den, içerideki araç + misafir sayısı
// canlı çeteleden (gunluk_kontroller türevi) gelir. 30sn'de bir + sekme
// odağında tazelenir. Superadmin'in site'si yok → çağrılmaz.
function IceriOzetBadge({ parkKapasitesi }) {
  const [ozet, setOzet] = useState(null);

  useEffect(() => {
    let iptal = false;
    async function yukle() {
      try {
        const { data } = await api.get('/kontroller/gece-cetelesi/ozet');
        if (!iptal) setOzet(data);
      } catch {
        // sessiz geç — header bilgi amaçlı, hata göstermeye değmez
      }
    }
    yukle();
    const id = setInterval(yukle, 30000);
    function onFocus() { yukle(); }
    window.addEventListener('focus', onFocus);
    return () => {
      iptal = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const park = parkKapasitesi ?? ozet?.park_kapasitesi ?? 0;
  const iceride = ozet?.icerideki_arac ?? 0;
  const misafir = ozet?.misafir_arac ?? 0;
  // Müsait yer = kapasite - içeride (negatif olamaz). Kapasite tanımsızsa (0) gizle.
  const musait = park > 0 ? Math.max(park - iceride, 0) : null;

  // Tek bölünmüş istatistik şeridi: sayı üstte, küçük etiket altta, ince
  // ayraçlarla. Müsait dolu→yeşil / 0→kırmızı; misafir küçük amber not.
  const musaitClass = musait === 0 ? 'text-rose-300' : 'text-emerald-300';
  // Dar telefonda taşmasın diye: padding küçük, etiketler mobilde kısaltılır
  // (İçeride→İç, Müsait→Boş). sm+ ekranda tam etiket.
  const Seg = ({ children, label, kisa, ...rest }) => (
    <div className="flex flex-col items-center justify-center px-2 sm:px-3.5 py-1 leading-none" {...rest}>
      {children}
      <span className="mt-0.5 text-[9px] sm:text-[10px] uppercase tracking-wider text-white/55 whitespace-nowrap">
        <span className="sm:hidden">{kisa}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
    </div>
  );
  return (
    <div className="flex items-stretch rounded-xl bg-white/10 ring-1 ring-white/15 divide-x divide-white/10 overflow-hidden flex-shrink-0">
      <Seg label="Park" kisa="Park" title="Sitenin toplam park (otopark) kapasitesi">
        <span className="text-sm sm:text-base font-bold tabular-nums text-white">{park > 0 ? park : '—'}</span>
      </Seg>
      <Seg
        label="İçeride"
        kisa="İç"
        title={`Şu an içeride ${iceride} araç${misafir > 0 ? ` (${misafir} misafir)` : ''}`}
      >
        <span className="text-sm sm:text-base font-bold tabular-nums text-white">
          {iceride}
          {misafir > 0 && (
            <span className="ml-0.5 align-top text-[9px] font-semibold text-amber-300">{misafir}m</span>
          )}
        </span>
      </Seg>
      {musait !== null && (
        <Seg label="Müsait" kisa="Boş" title={`Müsait park yeri (${park} − ${iceride})`}>
          <span className={`text-sm sm:text-base font-bold tabular-nums ${musaitClass}`}>{musait}</span>
        </Seg>
      )}
    </div>
  );
}

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

// Header'daki "Ayarlar" açılır menüsü — admin nav linkleri (role göre) + Şifre
// burada toplanır, böylece header kalabalıklaşmaz. Çıkış'ın hemen solunda durur.
function SettingsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-xs px-2.5 py-2 rounded-lg transition-colors ${
          open ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`}
      >
        <CogIcon className="w-4 h-4" />
        <span className="hidden sm:inline">Ayarlar</span>
        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-30 animate-scale-in origin-top-right"
        >
          {items.map((item) =>
            item.action ? (
              <button
                key={item.label}
                type="button"
                onClick={() => { setOpen(false); item.action(); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <item.Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`
                }
              >
                <item.Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, refresh } = useAuth();
  const isSiteAdmin = user?.rol === 'site_yonetici';
  const isSuperadmin = user?.rol === 'superadmin';
  const [numaralarAcik, setNumaralarAcik] = useState(false);

  // Ayarlar menüsü: role'e göre admin linkleri + (site yöneticisi) Yönetim
  // Numaraları (modal) + her kullanıcı için Şifre.
  const settingsItems = [
    ...(isSuperadmin ? superadminItems : isSiteAdmin ? adminItems : []),
    ...(isSiteAdmin
      ? [{ label: 'Yönetim Numaraları', Icon: PhoneIcon, action: () => setNumaralarAcik(true) }]
      : []),
    { to: '/sifre-degistir', label: 'Şifre Değiştir', Icon: LockClosedIcon },
  ];

  return (
    <div className="min-h-full pb-20 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <header className="bg-gradient-to-r from-brand-900 to-brand-800 dark:from-slate-900 dark:to-slate-800 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-20 shadow-lg">
        <Link to="/panel" className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm flex-shrink-0">
            <span className="text-lg">🅿️</span>
          </div>
          {/* Mobilde yer aç: sayım kutuları + Ayarlar menüsü sığsın diye
              wordmark'ı gizle (🅿️ logo kalır). sm+ ekranda tam görünür. */}
          <span className="hidden sm:inline font-bold text-xl tracking-tight flex-shrink-0">ParkTrack</span>
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
          <div className="flex items-center gap-1.5 sm:gap-3 text-sm min-w-0">
            {!isSuperadmin && user.site && (
              <IceriOzetBadge parkKapasitesi={user.site.park_kapasitesi} />
            )}
            <span className="hidden sm:flex items-center gap-2 text-white/80">
              <div className="w-8 h-8 bg-brand-600 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {user.kullanici_adi?.charAt(0).toUpperCase()}
              </div>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-medium text-white">{user.kullanici_adi}</span>
                <span className="text-white/40" aria-hidden="true">·</span>
                <span className="text-xs text-white/60">
                  {ROL_LABEL[user.rol] || user.rol}
                </span>
              </span>
            </span>
            <div className="flex items-center gap-1 sm:gap-2 border-l border-white/20 pl-1.5 sm:pl-3 flex-shrink-0">
              <ThemeToggle />
              <SettingsMenu items={settingsItems} />
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

      <footer className="px-4 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
        <Link to="/kvkk" className="hover:text-brand-600 dark:hover:text-brand-400 underline-offset-2 hover:underline">
          KVKK Aydınlatma Metni
        </Link>
      </footer>

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

      {numaralarAcik && (
        <NumaralarModal
          mevcut={user?.site?.bildirim_telefonlari || []}
          onClose={() => setNumaralarAcik(false)}
          onSaved={async () => { await refresh(); setNumaralarAcik(false); }}
        />
      )}
    </div>
  );
}
