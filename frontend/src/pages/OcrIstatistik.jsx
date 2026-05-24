import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/Icons';

const DAY_OPTIONS = [
  { value: 1, label: 'Son 24 saat' },
  { value: 7, label: 'Son 7 gün' },
  { value: 30, label: 'Son 30 gün' },
  { value: 90, label: 'Son 90 gün' },
];

// Backend dinamik engine etiketi gönderir; tabloyu okunabilir yapmak için
// label haritası. Bilinmeyen değer olduğu gibi gösterilir.
const ENGINE_LABELS = {
  easyocr: 'EasyOCR',
  'paddle_det+easyocr': 'PaddleOCR det + EasyOCR',
  'easyocr+paddle_available': 'EasyOCR (paddle hazır)',
  plate_recognizer: 'Plate Recognizer (API)',
};

function Metric({ label, value, hint, accent = 'brand' }) {
  const colorMap = {
    brand: 'text-brand-700 dark:text-brand-300',
    green: 'text-green-700 dark:text-green-300',
    amber: 'text-amber-700 dark:text-amber-300',
    red: 'text-red-700 dark:text-red-300',
    slate: 'text-slate-700 dark:text-slate-300',
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </div>
      <div className={`text-3xl font-bold ${colorMap[accent] || colorMap.brand} tabular-nums`}>
        {value}
      </div>
      {hint && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export default function OcrIstatistik() {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(d = days) {
    setLoading(true);
    try {
      const { data } = await api.get('/ocr-stats/summary', { params: { days: d } });
      setSummary(data);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(days); }, [days]); // eslint-disable-line

  const accuracyPct = summary?.accuracy != null ? Math.round(summary.accuracy * 100) : null;
  const accuracyAccent =
    accuracyPct == null ? 'slate' :
    accuracyPct >= 90 ? 'green' :
    accuracyPct >= 75 ? 'amber' : 'red';

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">OCR İstatistik</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Plaka tanıma doğruluğu ve gecikmesi. Doğruluk = kullanıcının düzeltmediği
            tahminlerin yüzdesi. İyileştirmelerin etkisini bu sayfadan ölç.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {DAY_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={days === opt.value ? 'primary' : 'outline'}
              onClick={() => setDays(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400">
          <LoadingSpinner className="w-6 h-6 mr-2" />
          Yükleniyor…
        </div>
      )}

      {!loading && summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric
              label="Doğruluk"
              value={accuracyPct != null ? `%${accuracyPct}` : '—'}
              hint={summary.total ? `${summary.untouched}/${summary.total} otomatik` : 'Veri yok'}
              accent={accuracyAccent}
            />
            <Metric
              label="Toplam OCR"
              value={summary.total ?? '—'}
              hint={`${days} gün`}
            />
            <Metric
              label="Medyan gecikme"
              value={summary.p50_ms != null ? `${summary.p50_ms} ms` : '—'}
              accent="slate"
            />
            <Metric
              label="p95 gecikme"
              value={summary.p95_ms != null ? `${summary.p95_ms} ms` : '—'}
              accent={summary.p95_ms == null ? 'slate' : summary.p95_ms > 5000 ? 'amber' : 'slate'}
              hint="95% istek bu sürenin altında"
            />
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                Motor bazlı karşılaştırma
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {summary.by_engine.length} motor
              </span>
            </div>
            {summary.by_engine.length === 0 ? (
              <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                Bu pencerede OCR verisi yok.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                  <tr>
                    <th className="p-3 font-medium text-slate-600 dark:text-slate-300">Motor</th>
                    <th className="p-3 font-medium text-slate-600 dark:text-slate-300 text-right">Toplam</th>
                    <th className="p-3 font-medium text-slate-600 dark:text-slate-300 text-right">Otomatik</th>
                    <th className="p-3 font-medium text-slate-600 dark:text-slate-300 text-right">Doğruluk</th>
                    <th className="p-3 font-medium text-slate-600 dark:text-slate-300 text-right">Ort. Gecikme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.by_engine.map((row) => {
                    const accPct = row.accuracy != null ? Math.round(row.accuracy * 100) : null;
                    const accClass =
                      accPct == null ? 'text-slate-500' :
                      accPct >= 90 ? 'text-green-700 dark:text-green-300' :
                      accPct >= 75 ? 'text-amber-700 dark:text-amber-300' :
                      'text-red-700 dark:text-red-300';
                    return (
                      <tr key={row.engine} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3 text-slate-800 dark:text-slate-200">
                          {ENGINE_LABELS[row.engine] || (
                            <span className="font-mono">{row.engine}</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">{row.total}</td>
                        <td className="p-3 text-right tabular-nums">{row.untouched}</td>
                        <td className={`p-3 text-right font-semibold tabular-nums ${accClass}`}>
                          {accPct != null ? `%${accPct}` : '—'}
                        </td>
                        <td className="p-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {row.avg_ms != null ? `${row.avg_ms} ms` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Not: Doğruluk metriği yalnız OCR'ın bir plaka döndürdüğü çağrıları sayar.
            Boş cevaplar ve servis hataları toplamın dışındadır. Bir kullanıcı plakayı
            düzeltirse o tahmin "yanlış" sayılır — fuzzy match veya öğrenme katmanının
            otomatik düzelttiği durumlar düzeltme sayılmaz.
          </div>
        </>
      )}
    </div>
  );
}
