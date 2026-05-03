import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { LockClosedIcon, ParkingIcon } from '../components/ui/Icons';

export default function Login() {
  const { login, loading } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [kullanici_adi, setKAdi] = useState('');
  const [sifre, setSifre] = useState('');
  const [err, setErr] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    try {
      await login(kullanici_adi.trim(), sifre);
      toast.success('Hoş geldiniz.');
      const dest = loc.state?.from || '/';
      nav(dest, { replace: true });
    } catch (e2) {
      setErr(apiError(e2));
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 via-slate-50 to-brand-100 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-200 rounded-full opacity-20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-brand-300 rounded-full opacity-20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-brand-200 rounded-full opacity-10" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-brand-300 rounded-full opacity-10" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Logo Section */}
        <div className="text-center mb-8 animate-slide-down">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-brand-500 to-brand-700 rounded-3xl shadow-xl shadow-brand-500/30 mb-4">
            <ParkingIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">ParkTrack</h1>
          <p className="text-slate-500 text-sm mt-1">Site Otopark Yönetim Sistemi</p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={onSubmit}
          className="bg-white rounded-3xl shadow-xl shadow-brand-100/50 p-8 flex flex-col gap-5 animate-scale-in"
        >
          <div className="text-center mb-2">
            <h2 className="text-xl font-bold text-slate-900">Giriş Yap</h2>
            <p className="text-sm text-slate-500 mt-1">Hesabınıza erişmek için giriş yapın</p>
          </div>

          <Input
            label="Kullanıcı Adı"
            autoComplete="username"
            autoFocus
            value={kullanici_adi}
            onChange={(e) => setKAdi(e.target.value)}
            placeholder="kullanici_adi"
          />
          
          <Input
            label="Şifre"
            type="password"
            autoComplete="current-password"
            value={sifre}
            onChange={(e) => setSifre(e.target.value)}
            placeholder="••••••••"
          />

          {err && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3 animate-slide-up">
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs">!</span>
              </div>
              <span>{err}</span>
            </div>
          )}

          <Button 
            type="submit" 
            disabled={loading || !kullanici_adi || !sifre}
            size="lg"
            className="w-full mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Giriş yapılıyor…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <LockClosedIcon className="w-5 h-5" />
                Giriş Yap
              </span>
            )}
          </Button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          © {new Date().getFullYear()} ParkTrack. Tüm hakları saklıdır.
        </p>
      </div>
    </div>
  );
}