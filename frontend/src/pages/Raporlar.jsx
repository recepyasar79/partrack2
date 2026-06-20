import { useEffect, useState, lazy, Suspense } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toCSV, downloadCSV } from '../utils/csv';

// Recharts bundle ~250KB — diğer Raporlar tab'larında gerek yok, lazy
const DashboardPanel = lazy(() => import('../components/RaporlarDashboard'));
const EmailSchedulesPanel = lazy(() => import('../components/EmailSchedulesPanel'));

const TABS = [
  { id: 'dashboard', label: 'Özet' },
  { id: 'giris_cikis', label: 'Giriş/Çıkış' },
  { id: 'ihlal', label: 'İhlal Geçmişi' },
  { id: 'ozet', label: 'Daire Özeti' },
  { id: 'bildirim', label: 'Bildirim Logları' },
  { id: 'email', label: 'Email Aboneliği' },
];

// Giriş/çıkış süresini insan-okur formata çevir (dk → "2s 15dk").
function fmtSure(dk) {
  if (dk == null) return '—';
  const h = Math.floor(dk / 60);
  const m = dk % 60;
  return h ? `${h}s ${m}dk` : `${m}dk`;
}

function tarihOffset(gun) {
  const d = new Date();
  d.setDate(d.getDate() + gun);
  // toISOString UTC'ye çevirir — TR'de gece 00:00-03:00 arası bir önceki
  // günü verir. 'sv-SE' locale'i yerel saatte YYYY-MM-DD üretir.
  return d.toLocaleDateString('sv-SE');
}

export default function Raporlar() {
  const toast = useToast();
  const [tab, setTab] = useState('dashboard');
  const [filt, setFilt] = useState({
    // Default: 2 gün önce → yarın. Akşam kontrolü gece yarısını geçebildiği
    // için son günlerin kayıtları kapsansın; yarın da dahil ki gece 00:00
    // sonrası girilenler pencere dışında kalmasın.
    baslangic: tarihOffset(-2),
    bitis: tarihOffset(1),
    durum: '',
  });
  const [ihlaller, setIhlaller] = useState([]);
  const [ozet, setOzet] = useState([]);
  const [bildirimler, setBildirimler] = useState([]);
  const [girisLog, setGirisLog] = useState([]);

  async function loadGirisLog() {
    try {
      const { data } = await api.get('/kontroller/log', {
        params: { baslangic: filt.baslangic, bitis: filt.bitis },
      });
      setGirisLog(data.kayitlar);
    } catch (e) { toast.error(apiError(e)); }
  }

  async function loadIhlal() {
    try {
      const { data } = await api.get('/kontroller/ihlaller', {
        params: { baslangic: filt.baslangic, bitis: filt.bitis },
      });
      setIhlaller(data.ihlaller);
    } catch (e) { toast.error(apiError(e)); }
  }
  async function loadOzet() {
    try {
      const { data } = await api.get('/kontroller/ihlaller/ozet', {
        params: { baslangic: filt.baslangic, bitis: filt.bitis },
      });
      setOzet(data.ozet);
    } catch (e) { toast.error(apiError(e)); }
  }
  async function loadBildirim() {
    try {
      const params = { baslangic: filt.baslangic, bitis: filt.bitis };
      if (filt.durum) params.durum = filt.durum;
      const { data } = await api.get('/bildirimler', { params });
      setBildirimler(data.bildirimler);
    } catch (e) { toast.error(apiError(e)); }
  }

  useEffect(() => {
    if (tab === 'ihlal') loadIhlal();
    else if (tab === 'ozet') loadOzet();
    else if (tab === 'bildirim') loadBildirim();
    else if (tab === 'giris_cikis') loadGirisLog();
  }, [tab, filt.baslangic, filt.bitis, filt.durum]); // eslint-disable-line

  function exportCsv() {
    const tarih = tarihOffset(0);
    if (tab === 'dashboard') return;
    if (tab === 'ihlal') {
      const csv = toCSV(ihlaller, [
        { key: 'kontrol_tarihi', label: 'Tarih', get: (r) => String(r.kontrol_tarihi).slice(0, 10) },
        { key: 'daire_no_snapshot', label: 'Daire' },
        { key: 'sahip_ad', label: 'Adı Soyadı' },
        { key: 'ihlal_tipi', label: 'Tip' },
        { key: 'plaka_listesi', label: 'Plakalar', get: (r) => (Array.isArray(r.plaka_listesi) ? r.plaka_listesi.join(' ') : r.plaka_listesi) },
      ]);
      downloadCSV(`ihlaller_${tarih}.csv`, csv);
    } else if (tab === 'ozet') {
      const csv = toCSV(ozet, [
        { key: 'daire_no', label: 'Daire' },
        { key: 'sahip_ad', label: 'Adı Soyadı' },
        { key: 'ihlal_sayisi', label: 'İhlal Sayısı' },
        { key: 'son_ihlal', label: 'Son İhlal', get: (r) => String(r.son_ihlal).slice(0, 10) },
      ]);
      downloadCSV(`ihlal_ozet_${tarih}.csv`, csv);
    } else if (tab === 'giris_cikis') {
      const csv = toCSV(girisLog, [
        { key: 'plaka', label: 'Plaka' },
        { key: 'daire_no', label: 'Daire', get: (r) => r.daire_no || '' },
        { key: 'giris', label: 'Giriş', get: (r) => new Date(r.giris).toLocaleString('tr-TR') },
        { key: 'cikis', label: 'Çıkış', get: (r) => (r.cikis ? new Date(r.cikis).toLocaleString('tr-TR') : 'İçeride') },
        { key: 'sure_dk', label: 'Süre (dk)', get: (r) => (r.sure_dk ?? '') },
      ]);
      downloadCSV(`giris_cikis_${tarih}.csv`, csv);
    } else {
      const csv = toCSV(bildirimler, [
        { key: 'olusturma_zamani', label: 'Zaman' },
        { key: 'daire_no', label: 'Daire' },
        { key: 'telefon', label: 'Telefon' },
        { key: 'gonderim_durumu', label: 'Durum' },
        { key: 'deneme_sayisi', label: 'Deneme' },
        { key: 'hata_mesaji', label: 'Hata' },
      ]);
      downloadCSV(`bildirimler_${tarih}.csv`, csv);
    }
  }

  async function exportPdf() {
    const tarih = tarihOffset(0);
    const donem = `${filt.baslangic} → ${filt.bitis}`;
    try {
      const { newRaporPDF } = await import('../utils/pdf');

      if (tab === 'dashboard') {
        const { data } = await api.get('/raporlar/dashboard', {
          params: { baslangic: filt.baslangic, bitis: filt.bitis },
        });
        const pdf = await newRaporPDF({ baslik: 'Özet Raporu', altBaslik: `Dönem: ${donem}` });
        pdf.addTable({
          head: [['Metrik', 'Değer']],
          body: [
            ['Yüklenen Foto', String(data.ozet.toplam_foto)],
            ['Kayıtsız Araç', String(data.ozet.kayitsiz_arac)],
            ['Çoklu Araç (Fazla)', String(data.ozet.coklu_fazla_arac)],
            ['Etkilenen Daire', String(data.ozet.etkilenen_daire)],
            ['Kontrol Günü', String(data.ozet.kontrol_yapilan_gun)],
            ['Bildirim Toplam', String(data.bildirim.toplam)],
            ['Bildirim Gönderildi', String(data.bildirim.gonderildi)],
            ['Bildirim Başarı', `%${data.bildirim.basari_orani}`],
          ],
        });
        if (data.top_daireler?.length) {
          pdf.addTable({
            startY: pdf.doc.lastAutoTable.finalY + 20,
            head: [['#', 'Daire', 'Adı Soyadı', 'İhlal', 'Son İhlal']],
            body: data.top_daireler.map((d, i) => [
              String(i + 1),
              d.daire_no,
              d.sahip_ad || '—',
              String(d.ihlal_sayisi),
              d.son_ihlal ? String(d.son_ihlal).slice(0, 10) : '—',
            ]),
          });
        }
        pdf.save(`ozet_${tarih}.pdf`);
      } else if (tab === 'ihlal') {
        const pdf = await newRaporPDF({ baslik: 'İhlal Geçmişi', altBaslik: `Dönem: ${donem} • ${ihlaller.length} kayıt` });
        pdf.addTable({
          head: [['Tarih', 'Daire', 'Adı Soyadı', 'Tip', 'Plakalar']],
          body: ihlaller.map((i) => [
            String(i.kontrol_tarihi).slice(0, 10),
            i.daire_no_snapshot || '—',
            i.sahip_ad || '—',
            i.ihlal_tipi,
            Array.isArray(i.plaka_listesi) ? i.plaka_listesi.join(', ') : String(i.plaka_listesi || ''),
          ]),
        });
        pdf.save(`ihlaller_${tarih}.pdf`);
      } else if (tab === 'ozet') {
        const pdf = await newRaporPDF({ baslik: 'Daire Özeti', altBaslik: `Dönem: ${donem} • ${ozet.length} daire` });
        pdf.addTable({
          head: [['Daire', 'Adı Soyadı', 'İhlal Sayısı', 'Son İhlal']],
          body: ozet.map((o) => [
            o.daire_no,
            o.sahip_ad || '—',
            String(o.ihlal_sayisi),
            o.son_ihlal ? String(o.son_ihlal).slice(0, 10) : '—',
          ]),
        });
        pdf.save(`ihlal_ozet_${tarih}.pdf`);
      } else if (tab === 'giris_cikis') {
        const pdf = await newRaporPDF({ baslik: 'Giriş/Çıkış Logu', altBaslik: `Dönem: ${donem} • ${girisLog.length} kayıt` });
        pdf.addTable({
          head: [['Plaka', 'Daire', 'Giriş', 'Çıkış', 'Süre']],
          body: girisLog.map((g) => [
            g.plaka,
            g.daire_no || '—',
            new Date(g.giris).toLocaleString('tr-TR'),
            g.cikis ? new Date(g.cikis).toLocaleString('tr-TR') : 'İçeride',
            fmtSure(g.sure_dk),
          ]),
        });
        pdf.save(`giris_cikis_${tarih}.pdf`);
      } else if (tab === 'bildirim') {
        const pdf = await newRaporPDF({ baslik: 'Bildirim Logları', altBaslik: `Dönem: ${donem} • ${bildirimler.length} kayıt` });
        pdf.addTable({
          head: [['Zaman', 'Daire', 'Telefon', 'Durum', 'Deneme', 'Hata']],
          body: bildirimler.map((b) => [
            new Date(b.olusturma_zamani).toLocaleString('tr-TR'),
            b.daire_no,
            b.telefon,
            b.gonderim_durumu,
            String(b.deneme_sayisi),
            b.hata_mesaji || '—',
          ]),
        });
        pdf.save(`bildirimler_${tarih}.pdf`);
      }
    } catch (e) {
      toast.error(apiError(e) || 'PDF üretilemedi.');
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Raporlar</h1>
        <div className="flex gap-2">
          {tab !== 'dashboard' && tab !== 'email' && (
            <Button variant="secondary" onClick={exportCsv}>CSV İndir</Button>
          )}
          {tab !== 'email' && (
            <Button variant="secondary" onClick={exportPdf}>PDF İndir</Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium transition ${
              tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'email' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-3 flex flex-wrap gap-2 items-end">
          <Input
            label="Başlangıç"
            type="date"
            value={filt.baslangic}
            onChange={(e) => setFilt({ ...filt, baslangic: e.target.value })}
          />
          <Input
            label="Bitiş"
            type="date"
            value={filt.bitis}
            onChange={(e) => setFilt({ ...filt, bitis: e.target.value })}
          />
          {tab === 'bildirim' && (
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700 dark:text-slate-200">Durum</label>
              <select
                value={filt.durum}
                onChange={(e) => setFilt({ ...filt, durum: e.target.value })}
                className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3"
              >
                <option value="">Tümü</option>
                <option value="gonderildi">Gönderildi</option>
                <option value="beklemede">Beklemede</option>
                <option value="basarisiz">Başarısız</option>
              </select>
            </div>
          )}
        </div>
      )}

      {tab === 'dashboard' && (
        <Suspense fallback={
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">Grafikler yükleniyor…</div>
        }>
          <DashboardPanel baslangic={filt.baslangic} bitis={filt.bitis} />
        </Suspense>
      )}

      {tab === 'email' && (
        <Suspense fallback={
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">Yükleniyor…</div>
        }>
          <EmailSchedulesPanel />
        </Suspense>
      )}

      {tab === 'giris_cikis' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="p-3">Plaka</th>
                <th className="p-3">Daire</th>
                <th className="p-3 whitespace-nowrap">Giriş</th>
                <th className="p-3 whitespace-nowrap">Çıkış</th>
                <th className="p-3 hidden sm:table-cell">Süre</th>
              </tr>
            </thead>
            <tbody>
              {girisLog.map((g) => (
                <tr key={g.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                  <td className="p-3 font-mono font-semibold">{g.plaka}</td>
                  <td className="p-3 font-mono">{g.daire_no || <span className="text-amber-600">kayıtsız</span>}</td>
                  <td className="p-3 text-xs whitespace-nowrap">{new Date(g.giris).toLocaleString('tr-TR')}</td>
                  <td className="p-3 text-xs whitespace-nowrap">
                    {g.cikis
                      ? new Date(g.cikis).toLocaleString('tr-TR')
                      : <span className="inline-flex items-center text-emerald-700 dark:text-emerald-300 font-medium bg-emerald-50 dark:bg-emerald-900/30 rounded px-1.5 py-0.5">İçeride</span>}
                  </td>
                  <td className="p-3 hidden sm:table-cell whitespace-nowrap">{fmtSure(g.sure_dk)}</td>
                </tr>
              ))}
              {girisLog.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ihlal' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="p-3">Tarih</th>
                <th className="p-3">Daire</th>
                <th className="p-3 hidden sm:table-cell">Adı Soyadı</th>
                <th className="p-3">Tip</th>
                <th className="p-3">Plakalar</th>
              </tr>
            </thead>
            <tbody>
              {ihlaller.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                  <td className="p-3 whitespace-nowrap">{String(i.kontrol_tarihi).slice(0, 10)}</td>
                  <td className="p-3 font-mono">{i.daire_no_snapshot || '—'}</td>
                  <td className="p-3 hidden sm:table-cell">{i.sahip_ad || '—'}</td>
                  <td className="p-3">{i.ihlal_tipi}</td>
                  <td className="p-3 font-mono text-xs">
                    {Array.isArray(i.plaka_listesi) ? i.plaka_listesi.join(', ') : i.plaka_listesi}
                  </td>
                </tr>
              ))}
              {ihlaller.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ozet' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="p-3">Daire</th>
                <th className="p-3">Adı Soyadı</th>
                <th className="p-3">İhlal Sayısı</th>
                <th className="p-3">Son İhlal</th>
              </tr>
            </thead>
            <tbody>
              {ozet.map((o, idx) => (
                <tr key={idx} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                  <td className="p-3 font-mono">{o.daire_no}</td>
                  <td className="p-3">{o.sahip_ad}</td>
                  <td className="p-3 font-bold">{o.ihlal_sayisi}</td>
                  <td className="p-3">{String(o.son_ihlal).slice(0, 10)}</td>
                </tr>
              ))}
              {ozet.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bildirim' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="p-3">Zaman</th>
                <th className="p-3">Daire</th>
                <th className="p-3 hidden sm:table-cell">Telefon</th>
                <th className="p-3">Durum</th>
                <th className="p-3">Deneme</th>
                <th className="p-3 hidden md:table-cell">Hata</th>
              </tr>
            </thead>
            <tbody>
              {bildirimler.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                  <td className="p-3 text-xs whitespace-nowrap">{new Date(b.olusturma_zamani).toLocaleString('tr-TR')}</td>
                  <td className="p-3 font-mono">{b.daire_no}</td>
                  <td className="p-3 hidden sm:table-cell">{b.telefon}</td>
                  <td className="p-3">
                    <span className={
                      b.gonderim_durumu === 'gonderildi' ? 'text-green-700' :
                      b.gonderim_durumu === 'basarisiz' ? 'text-red-700' :
                      'text-amber-700'
                    }>
                      {b.gonderim_durumu}
                    </span>
                  </td>
                  <td className="p-3">{b.deneme_sayisi}</td>
                  <td className="p-3 hidden md:table-cell text-xs text-slate-600 dark:text-slate-400">{b.hata_mesaji || '—'}</td>
                </tr>
              ))}
              {bildirimler.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500 dark:text-slate-400">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
