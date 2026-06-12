import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { isValidPlaka, normalizePlaka } from '../utils/validation';
import { CameraIcon, CheckIcon, XMarkIcon, ArrowPathIcon, LoadingSpinner } from '../components/ui/Icons';
import AuthImage from '../components/AuthImage';

const DURUM_MAP = {
  'sıkıştırılıyor': { label: 'Sıkıştırılıyor', color: 'text-slate-600', bg: 'bg-slate-100' },
  'yükleniyor': { label: 'Yükleniyor', color: 'text-blue-600', bg: 'bg-blue-100' },
  'OCR yapılıyor': { label: 'OCR yapılıyor', color: 'text-amber-600', bg: 'bg-amber-100' },
  'kontrol bekliyor': { label: 'Onay Bekliyor', color: 'text-purple-600', bg: 'bg-purple-100' },
  'onaylandı': { label: 'Onaylandı', color: 'text-green-600', bg: 'bg-green-100' },
  'hata': { label: 'Hata', color: 'text-red-600', bg: 'bg-red-100' },
};

export default function Kontrol() {
  const toast = useToast();
  const [bugun, setBugun] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [zoomImage, setZoomImage] = useState(null);
  const fileRef = useRef();
  const deletingRef = useRef(new Set());

  async function loadBugun() {
    try {
      const { data } = await api.get('/kontroller');
      setBugun(data.kontroller);
    } catch (e) { toast.error(apiError(e)); }
  }
  useEffect(() => { loadBugun(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!zoomImage) return;
    const onKey = (e) => { if (e.key === 'Escape') setZoomImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomImage]);

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const yeni = files.map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      previewUrl: URL.createObjectURL(f),
      durum: 'sıkıştırılıyor',
      plaka: '',
      ocrConfidence: null,
      ocrStrategy: null,
      ocrRawText: null,
      ocrError: null,
      kontrolId: null,
      hata: null,
    }));
    setItems((prev) => [...yeni, ...prev]);
    setBusy(true);

    // 2 paralel upload. Python OCR artık 2 uvicorn worker ile koşuyor;
    // ikiden fazla istekte sıra yine oluşur ama 2 paralel her vardiyada
    // ~%40 toplam süre kazandırır. Eskiden MAX_CONCURRENT=1 idi (tek
    // worker'ı tıkamamak için); 2'ye çıkarttık çünkü artık donanım var.
    const MAX_CONCURRENT = 2;
    let cursor = 0;
    async function worker() {
      while (cursor < yeni.length) {
        const idx = cursor++;
        const item = yeni[idx];
        await processOne(item);
      }
    }

    async function processOne(item) {
      try {
        // Compress aggressively — plates only need ~50px character height to
        // OCR reliably, so a 1200px-wide photo at quality 0.7 is plenty.
        // Going from 1.5MB to ~400KB triples upload speed on 3G/4G.
        const compressed = await imageCompression(item.file, {
          maxSizeMB: 0.4,
          maxWidthOrHeight: 1200,
          useWebWorker: true,
          initialQuality: 0.7,
        });

        updateItem(item.id, { durum: 'yükleniyor', uploadPct: 0 });

        const fd = new FormData();
        fd.append('foto', compressed, item.file.name);
        const { data } = await api.post('/kontroller/foto-upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // Sunucu tarafı OCR + fallback en kötü ~35s sürer; 2 dakika sonra
          // hâlâ cevap yoksa bağlantı ölmüştür — sonsuz bekleme yerine
          // anlamlı hata göster, kullanıcı tekrar denesin.
          timeout: 120000,
          onUploadProgress: (e) => {
            if (e.total) {
              const pct = Math.round((e.loaded / e.total) * 100);
              updateItem(item.id, { uploadPct: pct });
            }
          },
        });

        const ocr = data.ocr || {};
        const plaka = data.kontrol?.plaka || ocr.plate || '';

        updateItem(item.id, {
          durum: 'kontrol bekliyor',
          plaka,
          ocrConfidence: ocr.confidence,
          ocrStrategy: ocr.strategy,
          ocrRawText: ocr.raw_text,
          ocrError: ocr.error,
          ocrMatched: ocr.matched_to_registered,
          ocrElapsedMs: ocr.elapsed_ms,
          ocrNeedsReview: !!ocr.needs_manual_review,
          kontrolId: data.kontrol?.id || null,
        });
      } catch (err) {
        updateItem(item.id, { durum: 'hata', hata: apiError(err) });
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, yeni.length) }, () => worker());
    await Promise.all(workers);

    setBusy(false);
    loadBugun();
  }

  function updateItem(id, patch) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function onaylaPlaka(item) {
    const p = normalizePlaka(item.plaka);
    if (!isValidPlaka(p)) return toast.error('Plaka formatı geçersiz.');
    if (!item.kontrolId) return toast.error('Kontrol kaydı henüz oluşmadı.');
    try {
      await api.patch(`/kontroller/${item.kontrolId}/plaka`, { plaka: p });
      updateItem(item.id, { durum: 'onaylandı', plaka: p });
      toast.success(`${p} onaylandı.`);
      loadBugun();
    } catch (e) { toast.error(apiError(e)); }
  }

  async function silKontrol(kontrolId, itemId) {
    if (deletingRef.current.has(kontrolId)) return;
    if (!window.confirm('Bu kayıt silinsin mi?')) return;
    deletingRef.current.add(kontrolId);
    const dropFromState = () => {
      if (itemId) setItems((prev) => prev.filter((i) => i.id !== itemId));
      setBugun((prev) => prev.filter((k) => k.id !== kontrolId));
    };
    try {
      await api.delete(`/kontroller/${kontrolId}`);
      dropFromState();
      toast.success('Silindi.');
    } catch (e) {
      if (e?.response?.status === 404) {
        dropFromState();
      } else {
        toast.error(apiError(e));
      }
    } finally {
      deletingRef.current.delete(kontrolId);
    }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Akşam Kontrolü</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Plakaya odaklanan net foto çek. Sunucu OCR'ı çalışır, sonucu kontrol et ve onayla.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={onFiles}
            className="hidden"
            id="foto-input-camera"
          />
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFiles}
            className="hidden"
            id="foto-input-gallery"
          />
          <Button
            as="label"
            htmlFor="foto-input-camera"
            size="xl"
            className="cursor-pointer"
          >
            <CameraIcon className="w-6 h-6 mr-2" />
            Kameradan Çek
          </Button>
          <Button
            as="label"
            htmlFor="foto-input-gallery"
            variant="secondary"
            size="xl"
            className="cursor-pointer"
          >
            <CameraIcon className="w-6 h-6 mr-2" />
            Galeriden Yükle
          </Button>
        </div>
        <Link to="/kontrol/aksam" className="contents">
          <Button as="span" variant="success" size="xl" className="w-full cursor-pointer">
            <CheckIcon className="w-6 h-6 mr-2" />
            Akşam Kontrolünü Tamamla
          </Button>
        </Link>
      </div>

      {/* Session Uploads */}
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 bg-brand-500 rounded-full animate-pulse" />
            Bu oturumda yüklenenler ({items.length})
          </h2>
          <div className="grid gap-3">
            {items.map((it) => {
              const durumInfo = DURUM_MAP[it.durum] || DURUM_MAP['kontrol bekliyor'];
              const confPct = typeof it.ocrConfidence === 'number'
                ? Math.round(it.ocrConfidence * 100)
                : null;
              return (
                <div key={it.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-4 flex gap-4 hover:shadow-md transition-shadow">
                  <button
                    type="button"
                    onClick={() => setZoomImage({ url: it.previewUrl, plaka: it.plaka })}
                    className="w-28 h-28 shrink-0 overflow-hidden rounded-xl group cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-brand-500"
                    title="Büyüt"
                  >
                    <img
                      src={it.previewUrl}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110"
                    />
                  </button>
                  <div className="flex-1 flex flex-col gap-3">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${durumInfo.bg} ${durumInfo.color}`}>
                        {it.durum === 'yükleniyor' && <LoadingSpinner className="w-3 h-3" />}
                        {it.durum === 'OCR yapılıyor' && <ArrowPathIcon className="w-3 h-3 animate-spin" />}
                        {it.durum === 'onaylandı' && <CheckIcon className="w-3 h-3" />}
                        {it.durum === 'hata' && <XMarkIcon className="w-3 h-3" />}
                        {durumInfo.label}
                        {it.durum === 'yükleniyor' && typeof it.uploadPct === 'number' && (
                          <span className="ml-1 tabular-nums">%{it.uploadPct}</span>
                        )}
                      </span>
                      {confPct != null && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          confPct >= 70 ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                          confPct >= 40 ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                          'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}>
                          OCR güven: %{confPct}
                        </span>
                      )}
                      {it.ocrMatched && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          Kayıtlı plakaya eşlendi
                        </span>
                      )}
                      {it.ocrStrategy && (
                        <span className="text-xs text-slate-400 dark:text-slate-500" title={`Strateji: ${it.ocrStrategy}`}>
                          {it.ocrStrategy.split('/')[0]}
                        </span>
                      )}
                    </div>

                    {it.ocrError && (
                      <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 rounded-lg px-2 py-1">
                        ⚠️ {it.ocrError}
                      </div>
                    )}

                    {it.ocrNeedsReview && !it.ocrError && (
                      <div className="text-xs text-amber-800 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200 rounded-lg px-2 py-1 font-medium">
                        ⚠️ OCR güveni düşük — plakayı manuel kontrol edin
                      </div>
                    )}

                    {it.ocrRawText && !it.plaka && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Ham OCR: <span className="font-mono">{it.ocrRawText}</span>
                      </div>
                    )}

                    {it.hata && (
                      <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">
                        {it.hata}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end mt-auto">
                      <Input
                        value={it.plaka}
                        onChange={(e) => updateItem(it.id, { plaka: e.target.value.toUpperCase() })}
                        placeholder="Plaka"
                        containerClassName="flex-1"
                        className="font-mono"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="md"
                          variant={it.durum === 'onaylandı' ? 'success' : 'primary'}
                          onClick={() => onaylaPlaka(it)}
                          disabled={!it.kontrolId || it.durum === 'onaylandı'}
                          className="flex-1 sm:flex-none"
                        >
                          <CheckIcon className="w-4 h-4 mr-1" />
                          Onayla
                        </Button>
                        {it.kontrolId && (
                          <Button size="md" variant="ghost" onClick={() => silKontrol(it.kontrolId, it.id)}>
                            <XMarkIcon className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Uploads */}
      <div className="flex flex-col gap-3 mt-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Bugünün tüm yüklemeleri ({bugun.length})
        </h2>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-base">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-800 text-left">
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200 w-20">Foto</th>
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200">Plaka</th>
                <th className="p-4 font-semibold text-slate-700 dark:text-slate-200 hidden sm:table-cell">Zaman</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {bugun.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="p-2">
                    {k.foto_url ? (
                      <button
                        type="button"
                        onClick={() => setZoomImage({ url: k.foto_url, plaka: k.plaka, authed: true })}
                        className="w-16 h-16 overflow-hidden rounded-lg group cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-brand-500"
                        title="Büyüt"
                      >
                        <AuthImage
                          src={k.foto_url}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110"
                        />
                      </button>
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
                        <CameraIcon className="w-5 h-5" />
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`font-mono font-semibold ${k.plaka ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'}`}>
                      {k.plaka || '—'}
                    </span>
                  </td>
                  <td className="p-4 hidden sm:table-cell text-xs text-slate-500 dark:text-slate-400">
                    {new Date(k.yukleme_zamani).toLocaleTimeString('tr-TR')}
                  </td>
                  <td className="p-4 text-right">
                    <Button size="sm" variant="ghost" onClick={() => silKontrol(k.id)}>
                      <XMarkIcon className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {bugun.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                      <CameraIcon className="w-8 h-8" />
                      <p>Henüz yükleme yok.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {busy && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-brand-900/90 backdrop-blur-sm text-white text-sm px-5 py-3 rounded-full shadow-xl flex items-center gap-2 animate-fade-in">
          <LoadingSpinner className="w-5 h-5" />
          OCR çalışıyor…
        </div>
      )}

      {zoomImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setZoomImage(null)}
          role="dialog"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
            className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm"
            aria-label="Kapat"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
          {zoomImage.plaka && (
            <div className="absolute top-4 left-4 bg-white/15 backdrop-blur-sm text-white font-mono text-sm px-3 py-1.5 rounded-lg">
              {zoomImage.plaka}
            </div>
          )}
          {zoomImage.authed ? (
            <AuthImage
              src={zoomImage.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          ) : (
            <img
              src={zoomImage.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          )}
        </div>
      )}
    </div>
  );
}
