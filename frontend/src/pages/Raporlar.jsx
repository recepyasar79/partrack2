import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toCSV, downloadCSV } from '../utils/csv';

const TABS = [
  { id: 'ihlal', label: 'İhlal Geçmişi' },
  { id: 'ozet', label: 'Daire Özeti' },
  { id: 'bildirim', label: 'Bildirim Logları' },
];

function bugunMinusGun(g) {
  const d = new Date();
  d.setDate(d.getDate() - g);
  return d.toISOString().slice(0, 10);
}

export default function Raporlar() {
  const toast = useToast();
  const [tab, setTab] = useState('ihlal');
  const [filt, setFilt] = useState({
    baslangic: bugunMinusGun(30),
    bitis: bugunMinusGun(0),
    durum: '',
  });
  const [ihlaller, setIhlaller] = useState([]);
  const [ozet, setOzet] = useState([]);
  const [bildirimler, setBildirimler] = useState([]);

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
  }, [tab, filt.baslangic, filt.bitis, filt.durum]); // eslint-disable-line

  function exportCsv() {
    const tarih = new Date().toISOString().slice(0, 10);
    if (tab === 'ihlal') {
      const csv = toCSV(ihlaller, [
        { key: 'kontrol_tarihi', label: 'Tarih', get: (r) => String(r.kontrol_tarihi).slice(0, 10) },
        { key: 'daire_no_snapshot', label: 'Daire' },
        { key: 'sahip_ad', label: 'Sahip' },
        { key: 'ihlal_tipi', label: 'Tip' },
        { key: 'plaka_listesi', label: 'Plakalar', get: (r) => (Array.isArray(r.plaka_listesi) ? r.plaka_listesi.join(' ') : r.plaka_listesi) },
      ]);
      downloadCSV(`ihlaller_${tarih}.csv`, csv);
    } else if (tab === 'ozet') {
      const csv = toCSV(ozet, [
        { key: 'daire_no', label: 'Daire' },
        { key: 'sahip_ad', label: 'Sahip' },
        { key: 'ihlal_sayisi', label: 'İhlal Sayısı' },
        { key: 'son_ihlal', label: 'Son İhlal', get: (r) => String(r.son_ihlal).slice(0, 10) },
      ]);
      downloadCSV(`ihlal_ozet_${tarih}.csv`, csv);
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

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Raporlar</h1>
        <Button variant="secondary" onClick={exportCsv}>CSV İndir</Button>
      </div>

      <div className="flex gap-1 bg-white rounded-2xl shadow p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium transition ${
              tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow p-3 flex flex-wrap gap-2 items-end">
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
            <label className="text-sm">Durum</label>
            <select
              value={filt.durum}
              onChange={(e) => setFilt({ ...filt, durum: e.target.value })}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3"
            >
              <option value="">Tümü</option>
              <option value="gonderildi">Gönderildi</option>
              <option value="beklemede">Beklemede</option>
              <option value="basarisiz">Başarısız</option>
            </select>
          </div>
        )}
      </div>

      {tab === 'ihlal' && (
        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3">Tarih</th>
                <th className="p-3">Daire</th>
                <th className="p-3 hidden sm:table-cell">Sahip</th>
                <th className="p-3">Tip</th>
                <th className="p-3">Plakalar</th>
              </tr>
            </thead>
            <tbody>
              {ihlaller.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
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
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ozet' && (
        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3">Daire</th>
                <th className="p-3">Sahip</th>
                <th className="p-3">İhlal Sayısı</th>
                <th className="p-3">Son İhlal</th>
              </tr>
            </thead>
            <tbody>
              {ozet.map((o, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="p-3 font-mono">{o.daire_no}</td>
                  <td className="p-3">{o.sahip_ad}</td>
                  <td className="p-3 font-bold">{o.ihlal_sayisi}</td>
                  <td className="p-3">{String(o.son_ihlal).slice(0, 10)}</td>
                </tr>
              ))}
              {ozet.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-slate-500">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bildirim' && (
        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-slate-100 text-left">
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
                <tr key={b.id} className="border-t border-slate-100">
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
                  <td className="p-3 hidden md:table-cell text-xs text-slate-600">{b.hata_mesaji || '—'}</td>
                </tr>
              ))}
              {bildirimler.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">Kayıt yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
