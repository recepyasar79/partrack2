import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const cards = [
  { to: '/daireler', title: 'Daireler', desc: 'Daire ve araç tanımlamaları' },
  { to: '/araclar', title: 'Araç Listesi', desc: 'Tüm kayıtlı araçlar' },
  { to: '/misafir-araclar', title: 'Misafir Araç', desc: 'Geçici muafiyetler' },
  { to: '/kontrol', title: 'Akşam Kontrolü', desc: 'Foto yükle, ihlal tespit et' },
  { to: '/raporlar', title: 'Raporlar', desc: 'İhlal geçmişi & bildirimler' },
];

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Hoş geldiniz, {user?.kullanici_adi}</h1>
        <p className="text-slate-600 text-sm">
          {user?.rol === 'yonetici' ? 'Yönetici paneli' : 'Güvenlik paneli'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="bg-white rounded-2xl shadow p-4 hover:shadow-md transition active:scale-[0.98]"
          >
            <div className="font-semibold text-lg">{c.title}</div>
            <div className="text-sm text-slate-600">{c.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
