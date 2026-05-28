import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  ParkingIcon,
  CameraIcon,
  ShieldIcon,
  ChartIcon,
  UsersIcon,
  ArrowRightIcon,
  SunIcon,
  MoonIcon,
  CheckIcon,
} from '../components/ui/Icons';

const FEATURES = [
  {
    icon: CameraIcon,
    title: 'OCR Plaka Tanıma',
    desc: 'Güvenlik görevlisi araçların fotoğrafını çeker; sistem plakayı otomatik okur, manuel onayla geçer.',
    color: 'from-blue-500 to-blue-700',
  },
  {
    icon: ShieldIcon,
    title: 'Akşam Kontrolü',
    desc: 'Her daire için akşam otoparkında tek araç kuralı. 20:00 sonrası ihlalleri tek tıkla tespit edin.',
    color: 'from-emerald-500 to-emerald-700',
  },
  {
    icon: ChartIcon,
    title: 'Otomatik Raporlar',
    desc: 'WhatsApp bildirimleri, e-posta özetleri, PDF/CSV dışa aktarım. Aylık trend ve sahip tarihçesi.',
    color: 'from-amber-500 to-amber-700',
  },
];

const BENEFITS = [
  'Manuel kayıt defterine elveda — her şey dijital',
  'Misafir araç tanımıyla gerçek ihlal tespit',
  'Site yöneticisi + güvenlik için rol bazlı yetkiler',
  'KVKK uyumlu veri saklama ve tarihçe',
];

export default function Landing() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  // Login olmuşsa direkt panele
  if (user) {
    const dest = user.rol === 'superadmin' ? '/sites' : '/panel';
    return <Navigate to={dest} replace />;
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-brand-50 via-slate-50 to-brand-100 dark:from-slate-950 dark:via-slate-900 dark:to-brand-950 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand-200 dark:bg-brand-800 rounded-full opacity-20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-brand-300 dark:bg-brand-700 rounded-full opacity-20 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 px-4 sm:px-8 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-700 rounded-xl shadow-lg shadow-brand-500/30 flex items-center justify-center group-hover:scale-105 transition-transform">
            <ParkingIcon className="w-6 h-6 text-white" />
          </div>
          <span className="text-lg font-bold gradient-text">ParkTrack</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Gündüz temasına geç' : 'Gece temasına geç'}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/70 dark:bg-slate-800/70 backdrop-blur text-slate-700 dark:text-slate-200 shadow-md hover:bg-white dark:hover:bg-slate-700 transition-colors"
          >
            {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
          </button>
          <Link
            to="/login"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-semibold shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition"
          >
            Giriş Yap
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 pt-12 pb-16 sm:pt-20 sm:pb-24 text-center animate-slide-down">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
          Site Otopark Yönetim Sistemi
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mb-5">
          Site otoparkında{' '}
          <span className="gradient-text">akıllı denetim</span>.
        </h1>

        <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto mb-8">
          Her daireye akşam otoparkında tek araç kuralı — ParkTrack bunu sizin yerinize takip eder.
          Güvenlik plakayı çeker, sistem ihlali bulur, WhatsApp ile sahibine bildirir.
          Aksama hâkim, sahada hafif.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-semibold shadow-lg shadow-brand-500/30 hover:shadow-xl hover:scale-105 active:scale-95 transition"
          >
            Giriş Yap
            <ArrowRightIcon className="w-5 h-5" />
          </Link>
          <a
            href="#nasil-calisir"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            Nasıl Çalışır?
          </a>
        </div>
      </section>

      {/* Features */}
      <section
        id="nasil-calisir"
        className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 pb-16 sm:pb-24"
      >
        <h2 className="text-center text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">
          Ne yapıyoruz?
        </h2>
        <p className="text-center text-slate-500 dark:text-slate-400 mb-10 max-w-xl mx-auto">
          Site güvenlik ekibinin elinden klemensli defter, telefon zincirli mesaj
          ve gözden kaçan ihlalleri alır.
        </p>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, color }, i) => (
            <div
              key={title}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-md hover:shadow-xl border border-transparent dark:border-slate-800 hover:-translate-y-1 transition-all animate-scale-in"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className={`inline-flex w-12 h-12 rounded-xl bg-gradient-to-br ${color} text-white items-center justify-center shadow-md mb-4`}>
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100 mb-2">
                {title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Audience + benefits */}
      <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 pb-16 sm:pb-24">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-10 shadow-md border border-transparent dark:border-slate-800 grid gap-8 md:grid-cols-2 items-center">
          <div>
            <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white items-center justify-center shadow-md mb-4">
              <UsersIcon className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
              Kimler için?
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-2">
              <strong className="text-slate-800 dark:text-slate-200">Site yöneticileri</strong>{' '}
              için: daire/araç kayıt, sahip değişimi tarihçesi, ihlal raporları,
              abonelik ve email rapor planları.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              <strong className="text-slate-800 dark:text-slate-200">Güvenlik görevlileri</strong>{' '}
              için: telefonla fotoğraf çek → plaka otomatik okunsun → akşam
              kontrolünü tek tıkla bitir.
            </p>
          </div>

          <ul className="space-y-3">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mt-0.5">
                  <CheckIcon className="w-4 h-4" />
                </span>
                <span className="text-sm text-slate-700 dark:text-slate-300">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA bottom */}
      <section className="relative z-10 max-w-3xl mx-auto px-4 sm:px-8 pb-16 sm:pb-20 text-center">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 rounded-3xl p-8 sm:p-12 text-white shadow-xl">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            Sitenizin otoparkını ParkTrack'e bırakın
          </h2>
          <p className="text-brand-100 mb-6 text-sm sm:text-base">
            Yöneticinizden site kodunuzu ve giriş bilgilerinizi alın.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-brand-700 font-semibold shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition"
          >
            Giriş Yap
            <ArrowRightIcon className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 dark:border-slate-800 py-6 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
          <span>© {new Date().getFullYear()} ParkTrack. Tüm hakları saklıdır.</span>
          <Link to="/kvkk" className="hover:text-brand-600 dark:hover:text-brand-400 hover:underline">
            KVKK Aydınlatma Metni
          </Link>
        </div>
      </footer>
    </div>
  );
}
