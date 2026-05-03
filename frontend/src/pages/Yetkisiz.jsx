import { Link } from 'react-router-dom';

export default function Yetkisiz() {
  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <h1 className="text-xl font-bold mb-2">Yetkiniz yok</h1>
      <p className="text-slate-600 mb-4">Bu sayfayı görüntüleme yetkiniz bulunmuyor.</p>
      <Link to="/" className="text-blue-600 underline">Ana sayfaya dön</Link>
    </div>
  );
}
