import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { isValidPlaka, normalizePlaka } from '../utils/validation';

export default function Kontrol() {
  const toast = useToast();
  const [bugun, setBugun] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  async function loadBugun() {
    try {
      const { data } = await api.get('/kontroller');
      setBugun(data.kontroller);
    } catch (e) { toast.error(apiError(e)); }
  }
  useEffect(() => { loadBugun(); }, []); // eslint-disable-line

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
        try {
          const { recognizePlate } = await import('../services/plateOCR');
          const r = await recognizePlate(item.file);
          ocrPlaka = r.guess;
          ocrConfidence = r.confidence;
          ocrRaw = r.raw;
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
      <div>
        <h1 className="text-2xl font-bold">Akşam Kontrolü — Foto Yükleme</h1>
        <p className="text-sm text-slate-600">
          Plakaya odaklanan net foto çek. OCR sonucunu kontrol et, yanlışsa düzelt ve onayla.
        </p>
      </div>

      <div className="flex flex-col gap-2">
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
          size="lg"
          className="cursor-pointer"
        >
          📷 Foto Çek / Yükle
        </Button>
        <Link to="/kontrol/aksam">
          <Button as="span" variant="secondary" size="lg" className="w-full cursor-pointer">
            ✓ Akşam Kontrolünü Tamamla →
          </Button>
        </Link>
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Bu oturumda yüklenenler ({items.length})</h2>
          {items.map((it) => (
            <div key={it.id} className="bg-white rounded-2xl shadow p-3 flex gap-3">
              <img src={it.previewUrl} alt="" className="w-24 h-24 object-cover rounded-lg" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-xs text-slate-500">
                  {it.durum}
                  {it.ocrConfidence != null && ` · OCR güven: %${Math.round(it.ocrConfidence)}`}
                </div>
                {it.ocrRaw && it.ocrConfidence < 50 && (
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer">OCR ham çıktı</summary>
                    <pre className="whitespace-pre-wrap break-all mt-1">{it.ocrRaw}</pre>
                  </details>
                )}
                {it.ocrError && <div className="text-xs text-amber-600">OCR hata: {it.ocrError}</div>}
                {it.hata && <div className="text-sm text-red-600">{it.hata}</div>}
                <div className="flex gap-2 items-end">
                  <Input
                    value={it.plaka}
                    onChange={(e) => updateItem(it.id, { plaka: e.target.value.toUpperCase() })}
                    placeholder="Plaka"
                    containerClassName="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => onaylaPlaka(it)}
                    disabled={!it.kontrolId || it.durum === 'onaylandı'}
                  >
                    Onayla
                  </Button>
                  {it.kontrolId && (
                    <Button size="sm" variant="danger" onClick={() => silKontrol(it.kontrolId, it.id)}>
                      Sil
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-4">
        <h2 className="text-lg font-semibold">Bugünün tüm yüklemeleri ({bugun.length})</h2>
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3">Plaka</th>
                <th className="p-3 hidden sm:table-cell">Zaman</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {bugun.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono">{k.plaka || '—'}</td>
                  <td className="p-3 hidden sm:table-cell text-xs text-slate-500">
                    {new Date(k.yukleme_zamani).toLocaleTimeString('tr-TR')}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => silKontrol(k.id)}>Sil</Button>
                  </td>
                </tr>
              ))}
              {bugun.length === 0 && (
                <tr><td colSpan={3} className="p-6 text-center text-slate-500">Henüz yükleme yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {busy && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          Yükleniyor…
        </div>
      )}
    </div>
  );
}
