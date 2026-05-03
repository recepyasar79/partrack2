import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';

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
    <div className="min-h-full flex items-center justify-center p-6 bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow p-6 flex flex-col gap-4"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold">ParkTrack</h1>
          <p className="text-sm text-slate-500">Site Otopark Yönetimi</p>
        </div>
        <Input
          label="Kullanıcı adı"
          autoComplete="username"
          autoFocus
          value={kullanici_adi}
          onChange={(e) => setKAdi(e.target.value)}
        />
        <Input
          label="Şifre"
          type="password"
          autoComplete="current-password"
          value={sifre}
          onChange={(e) => setSifre(e.target.value)}
        />
        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {err}
          </div>
        )}
        <Button type="submit" disabled={loading || !kullanici_adi || !sifre}>
          {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </Button>
      </form>
    </div>
  );
}
