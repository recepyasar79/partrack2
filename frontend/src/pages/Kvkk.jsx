import { Link } from 'react-router-dom';

export default function Kvkk() {
  return (
    <div className="min-h-full bg-slate-50">
      <header className="bg-slate-900 text-white p-4">
        <Link to="/" className="font-bold text-lg">ParkTrack</Link>
      </header>
      <main className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">KVKK Aydınlatma Metni</h1>
        <div className="bg-white rounded-2xl shadow p-6 text-sm text-slate-700 space-y-4 leading-relaxed">
          <p>
            <strong>Veri Sorumlusu:</strong> Site Yönetimi (ParkTrack uygulaması üzerinden işlenir).
          </p>
          <h2 className="font-semibold text-base mt-4">İşlenen Kişisel Veriler</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>Daire sahibi ad-soyad</li>
            <li>Telefon numarası (yalnızca site sakinine ait)</li>
            <li>Araç plakası</li>
            <li>KVKK rıza onay tarihi</li>
            <li>Site otoparkından çekilen plaka fotoğrafları (en fazla 90 gün saklanır)</li>
          </ul>
          <h2 className="font-semibold text-base mt-4">İşleme Amacı</h2>
          <p>
            Site içi otopark yönetimi: her dairenin yalnızca bir aracının site otoparkında gece konaklamasını
            sağlamak, ihlal durumunda daire sahibini bilgilendirmek, kayıtsız araçları tespit etmek.
          </p>
          <h2 className="font-semibold text-base mt-4">Hukuki Sebep</h2>
          <p>
            KVKK 5/2-c (sözleşmenin ifası — yönetim planı) ve 5/2-f (meşru menfaat — site düzeni) hükümleri.
            Telefon numarası üzerinden WhatsApp ile bildirim için ayrıca <em>açık rıza</em> alınır ve istenildiği
            zaman geri çekilebilir.
          </p>
          <h2 className="font-semibold text-base mt-4">Saklama Süresi</h2>
          <p>
            Daire sahibi olduğunuz süre boyunca + sözleşme/sakinlik sona erdikten sonra 90 gün. Fotoğraflar 90
            gün sonra otomatik olarak silinir.
          </p>
          <h2 className="font-semibold text-base mt-4">Haklarınız</h2>
          <p>
            KVKK md. 11 kapsamında bilgi alma, düzeltme, silme ve itiraz haklarına sahipsiniz. Talepleriniz için
            site yönetimi ile yazılı olarak iletişime geçebilirsiniz.
          </p>
          <h2 className="font-semibold text-base mt-4">Veri Güvenliği</h2>
          <p>
            Veriler şifrelenmiş bağlantı (HTTPS) üzerinden iletilir, şifreler bcrypt ile özetlenir, erişimler
            audit log ile kayıt altına alınır. Üçüncü kişilerle paylaşılmaz.
          </p>
        </div>
        <div className="mt-6 text-center">
          <Link to="/" className="text-blue-600 underline">Ana sayfaya dön</Link>
        </div>
      </main>
    </div>
  );
}
