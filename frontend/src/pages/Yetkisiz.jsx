import { Link } from 'react-router-dom';

export default function Yetkisiz() {
  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <h1 className="text-xl font-bold mb-2 text-slate-900 dark:text-slate-100">Yetkiniz yok</h1>
      <p className="text-slate-600 dark:text-slate-400 mb-4">Bu sayfayı görüntüleme yetkiniz bulunmuyor.</p>
      <Link to="/" className="text-blue-600 dark:text-blue-400 underline">Ana sayfaya dön</Link>
    </div>
  );
}
