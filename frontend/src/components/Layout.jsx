import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const navItems = [
  { to: '/daireler', label: 'Daireler', icon: '🏢' },
  { to: '/araclar', label: 'Araçlar', icon: '🚗' },
  { to: '/misafir-araclar', label: 'Misafir', icon: '🪪' },
  { to: '/kontrol', label: 'Kontrol', icon: '📷' },
  { to: '/raporlar', label: 'Rapor', icon: '📊' },
];

const adminItems = [
  { to: '/kullanicilar', label: 'Kullanıcılar' },
  { to: '/audit', label: 'Audit Log' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const isYonetici = user?.rol === 'yonetici';

  return (
    <div className="min-h-full pb-20">
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <Link to="/" className="font-bold text-lg">ParkTrack</Link>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-slate-300">
              {user.kullanici_adi} · {user.rol === 'yonetici' ? 'Yönetici' : 'Güvenlik'}
            </span>
            {isYonetici && (
              <div className="hidden md:flex gap-2">
                {adminItems.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    className={({ isActive }) =>
                      `text-xs px-2 py-1 rounded ${isActive ? 'bg-slate-700' : 'hover:bg-slate-800'}`
                    }
                  >
                    {i.label}
                  </NavLink>
                ))}
              </div>
            )}
            <Link to="/sifre-degistir" className="text-xs text-slate-300 hover:text-white">Şifre</Link>
            <button onClick={logout} className="text-xs text-slate-300 hover:text-white">Çıkış</button>
          </div>
        )}
      </header>

      <main>{children}</main>

      {user && (
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 grid grid-cols-5 z-10">
          {navItems.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 text-xs min-h-[56px] ${
                  isActive ? 'text-blue-600 font-semibold' : 'text-slate-600'
                }`
              }
            >
              <span className="text-xl">{i.icon}</span>
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
