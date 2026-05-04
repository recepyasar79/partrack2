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
  'OCR yapılıyor': { label: 'OCR yapılıyor', color: 'text-amber-600', bg: 'bg-amber-100' },
  'yükleniyor': { label: 'Yükleniyor', color: 'text-blue-600', bg: 'bg-blue-100' },
  'kontrol bekliyor': { label: 'Onay Bekliyor', color: 'text-purple-600', bg: 'bg-purple-100' },
  'onaylandı': { label: 'Onaylandı', color: 'text-green-600', bg: 'bg-green-100' },
  'hata': { label: 'Hata', color: 'text-red-600', bg: 'bg-red-100' },
};

export default function Kontrol() {
  const toast = useToast();
  const [bugun, setBugun] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [usePlateDetector, setUsePlateDetector] = useState(() => {
    const v = localStorage.getItem('usePlateDetector');
    return v === null ? true : v === '1';
  });
  const [zoomImage, setZoomImage] = useState(null);
  const fileRef = useRef();

  function toggleDetector(v) {
    setUsePlateDetector(v);
    localStorage.setItem('usePlateDetector', v ? '1' : '0');
  }

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
      kontrolId: null,
      hata: null,
    }));
    setItems((prev) => [...yeni, ...prev]);
    setBusy(true);

    for (const item of yeni) {
      try {
        updateItem(item.id, { durum: 'OCR yapılıyor' });

        let ocrPlaka = '';
        let ocrConfidence = 0;
        let ocrRaw = '';
        let ocrError = null;
        let ocrSource = null;
        try {
          const { recognizePlate } = await import('../services/plateOCR');
          const r = await recognizePlate(item.file, {
            usePlateDetector,
            onProgress: (msg) => updateItem(item.id, { ocrProgress: msg }),
          });
          ocrPlaka = r.guess;
          ocrConfidence = r.confidence;
          ocrRaw = r.raw;
          ocrSource = r.source;
          if (r.error) ocrError = r.error;
        } catch (ocrErr) {
          console.warn('OCR hata:', ocrErr);
          ocrError = ocrErr.message;
        }

        updateItem(item.id, {
          durum: 'sıkıştırılıyor',
          plaka: ocrPlaka,
          ocrConfidence,
          ocrRaw,
          ocrError,
          ocrSource,
        });

        const compressed = await imageCompression(item.file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
        });

        updateItem(item.id, { durum: 'yükleniyor' });

        const fd = new FormData();
        fd.append('foto', compressed, item.file.name);
        if (ocrPlaka) fd.append('plaka', ocrPlaka);
        const { data } = await api.post('/kontroller/foto-upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        updateItem(item.id, { durum: 'kontrol bekliyor', kontrolId: data.kontrol.id });
      } catch (err) {
        updateItem(item.id, { durum: 'hata', hata: apiError(err) });
      }
    }
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
    if (!window.confirm('Bu kayıt silinsin mi?')) return;
    try {
      await api.delete(`/kontroller/${kontrolId}`);
      if (itemId) setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success('Silindi.');
      loadBugun();
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Akşam Kontrolü</h1>
        <p className="text-sm text-slate-600 mt-1">
          Plakaya odaklanan net foto çek. OCR sonucunu kontrol et, yanlışsa düzelt ve onayla.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          multiple
          onChange={onFiles}
          className="hidden"
          id="foto-input"
        />
        <Button
          as="label"
          htmlFor="foto-input"
          size="xl"
          className="cursor-pointer"
        >
          <CameraIcon className="w-6 h-6 mr-2" />
          Foto Çek / Yükle
        </Button>
        <Link to="/kontrol/aksam" className="contents">
          <Button as="span" variant="success" size="xl" className="w-full cursor-pointer">
            <CheckIcon className="w-6 h-6 mr-2" />
            Akşam Kontrolünü Tamamla
          </Button>
        </Link>
      </div>

      <label className="flex items-center gap-2 text-sm bg-white rounded-xl p-3 border border-slate-200">
        <input
          type="checkbox"
          checked={usePlateDetector}
          onChange={(e) => toggleDetector(e.target.checked)}
          className="w-5 h-5"
        />
        <span>
          <strong>Plaka tespit modu</strong> — açıkken foto'da önce plaka bandı bulunur ve sadece
          o bölge OCR'a verilir (saf JS, ek download yok). Kapalıyken OCR tüm fotoğrafa uygulanır.
        </span>
      </label>

      {/* Session Uploads */}
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-2 h-2 bg-brand-500 rounded-full animate-pulse" />
            Bu oturumda yüklenenler ({items.length})
          </h2>
          <div className="grid gap-3">
            {items.map((it) => {
              const durumInfo = DURUM_MAP[it.durum] || DURUM_MAP['kontrol bekliyor'];
              return (
                <div key={it.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex gap-4 hover:shadow-md transition-shadow">
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
                    {/* Status Badge */}
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${durumInfo.bg} ${durumInfo.color}`}>
                        {it.durum === 'yükleniyor' && <LoadingSpinner className="w-3 h-3" />}
                        {it.durum === 'OCR yapılıyor' && <ArrowPathIcon className="w-3 h-3 animate-spin" />}
                        {it.durum === 'onaylandı' && <CheckIcon className="w-3 h-3" />}
                        {it.durum === 'hata' && <XMarkIcon className="w-3 h-3" />}
                        {durumInfo.label}
                      </span>
                      {it.ocrConfidence != null && (
                        <span className="text-xs text-slate-400">
                          OCR: %{Math.round(it.ocrConfidence)}
                        </span>
                      )}
                      {it.ocrSource && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          it.ocrSource === 'detector' ? 'bg-emerald-50 text-emerald-700' :
                          it.ocrSource === 'fallback' ? 'bg-slate-100 text-slate-500' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {it.ocrSource === 'detector' ? '🎯 Plaka tespit' :
                           it.ocrSource === 'fallback' ? 'tüm foto' : 'detector hata'}
                        </span>
                      )}
                    </div>

                    {it.durum === 'OCR yapılıyor' && it.ocrProgress && (
                      <div className="text-xs text-slate-500 italic">→ {it.ocrProgress}</div>
                    )}
                    
                    {/* OCR Debug */}
                    {it.ocrRaw && it.ocrConfidence < 50 && (
                      <details className="text-xs bg-slate-50 rounded-lg p-2">
                        <summary className="cursor-pointer text-slate-500 font-medium">OCR ham çıktı</summary>
                        <pre className="whitespace-pre-wrap break-all mt-1 text-slate-400">{it.ocrRaw}</pre>
                      </details>
                    )}
                    
                    {it.ocrError && (
                      <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
                        ⚠️ OCR hata: {it.ocrError}
                      </div>
                    )}
                    
                    {it.hata && (
                      <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                        {it.hata}
                      </div>
                    )}
                    
                    {/* Actions */}
                    <div className="flex gap-2 items-end mt-auto">
                      <Input
                        value={it.plaka}
                        onChange={(e) => updateItem(it.id, { plaka: e.target.value.toUpperCase() })}
                        placeholder="Plaka"
                        containerClassName="flex-1"
                        className="font-mono"
                      />
                      <Button
                        size="md"
                        variant={it.durum === 'onaylandı' ? 'success' : 'primary'}
                        onClick={() => onaylaPlaka(it)}
                        disabled={!it.kontrolId || it.durum === 'onaylandı'}
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
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Uploads */}
      <div className="flex flex-col gap-3 mt-2">
        <h2 className="text-lg font-bold text-slate-900">
          Bugünün tüm yüklemeleri ({bugun.length})
        </h2>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100 text-left">
                <th className="p-4 font-semibold text-slate-700 w-20">Foto</th>
                <th className="p-4 font-semibold text-slate-700">Plaka</th>
                <th className="p-4 font-semibold text-slate-700 hidden sm:table-cell">Zaman</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bugun.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50 transition-colors">
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
                      <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300">
                        <CameraIcon className="w-5 h-5" />
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`font-mono font-semibold ${k.plaka ? 'text-brand-700' : 'text-slate-400'}`}>
                      {k.plaka || '—'}
                    </span>
                  </td>
                  <td className="p-4 hidden sm:table-cell text-xs text-slate-500">
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
                    <div className="flex flex-col items-center gap-2 text-slate-400">
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

      {/* Loading Overlay */}
      {busy && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-brand-900/90 backdrop-blur-sm text-white text-sm px-5 py-3 rounded-full shadow-xl flex items-center gap-2 animate-fade-in">
          <LoadingSpinner className="w-5 h-5" />
          Yükleniyor…
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