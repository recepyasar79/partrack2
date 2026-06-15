import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { api, apiError } from '../services/api';
import { captureException } from '../sentry';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { isValidPlakaSerbest, normalizePlaka } from '../utils/validation';
import { CameraIcon, CheckIcon, XMarkIcon, ArrowPathIcon, LoadingSpinner, MagnifyingGlassIcon, CarCartoonIcon, PhotoIcon, PencilSquareIcon, ClipboardDocumentCheckIcon, BuildingIcon } from '../components/ui/Icons';
import AuthImage from '../components/AuthImage';

const DURUM_MAP = {
  'sıkıştırılıyor': { label: 'Sıkıştırılıyor', color: 'text-slate-600', bg: 'bg-slate-100' },
  'yükleniyor': { label: 'Yükleniyor', color: 'text-blue-600', bg: 'bg-blue-100' },
  'OCR yapılıyor': { label: 'OCR yapılıyor', color: 'text-amber-600', bg: 'bg-amber-100' },
  'kontrol bekliyor': { label: 'Onay Bekliyor', color: 'text-purple-600', bg: 'bg-purple-100' },
  'onaylandı': { label: 'Onaylandı', color: 'text-green-600', bg: 'bg-green-100' },
  'hata': { label: 'Hata', color: 'text-red-600', bg: 'bg-red-100' },
};

// "B3" → "B003", "A21" → "A021" — blok harfi + sıfır-dolgulu sıra no, böylece
// string karşılaştırması blok-sonra-numarayı doğru sıralar (A2 < A10, naif
// alfabetik sırada A10 < A2 olurdu). Dairesi olmayan (kayıtsız/boş plaka)
// kayıtlar null döner → sıralamada her zaman sona iner.
function daireSortKey(k) {
  const d = (k.daire_no || '').trim();
  if (!d) return null;
  const m = /^([A-Za-z]+)\s*(\d+)$/.exec(d);
  if (!m) return d.toUpperCase();
  return `${m[1].toUpperCase()}${String(parseInt(m[2], 10)).padStart(3, '0')}`;
}

// Sıralayıcı üretici — null anahtarlar yönden bağımsız her zaman sona iner ki
// kayıtsız/dairesiz kayıtlar (asc da olsa desc de olsa) listenin altında
// toplansın, üstü gerçek verilere kalsın.
function makeCmp(keyFn, dir) {
  return (a, b) => {
    const va = keyFn(a);
    const vb = keyFn(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'desc' ? -c : c;
  };
}

const SIRALAYICILAR = {
  zaman_desc: makeCmp((k) => new Date(k.yukleme_zamani).getTime(), 'desc'),
  zaman_asc: makeCmp((k) => new Date(k.yukleme_zamani).getTime(), 'asc'),
  plaka_asc: makeCmp((k) => k.plaka || null, 'asc'),
  plaka_desc: makeCmp((k) => k.plaka || null, 'desc'),
  daire_asc: makeCmp(daireSortKey, 'asc'),
  daire_desc: makeCmp(daireSortKey, 'desc'),
};

export default function Kontrol() {
  const toast = useToast();
  const [bugun, setBugun] = useState([]);
  const [arama, setArama] = useState('');
  const [daireArama, setDaireArama] = useState('');
  const [siralama, setSiralama] = useState('zaman_desc');
  const [manuelAcik, setManuelAcik] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [kameraAcik, setKameraAcik] = useState(false);
  const [zoomImage, setZoomImage] = useState(null);
  const deletingRef = useRef(new Set());
  // Kamera seri çekimde birden çok handleNewFiles çağrısı paralel koşabilir;
  // ref sayaç ile yalnız hepsi bitince overlay kapanır.
  const busyCountRef = useRef(0);

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

  // Yükleme/işleme sürerken sayfadan ayrılma/yenileme uyarısı. overscroll-behavior
  // (index.css) kazara pull-to-refresh'i zaten kapatıyor; bu da bilerek yenileme
  // ya da geri tuşunda "emin misin?" sorarak in-flight upload'ların ve oturum
  // sonuçlarının kaybını önler.
  useEffect(() => {
    if (!busy) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [busy]);

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await handleNewFiles(files);
  }

  // Hem dosya inputundan (galeri) hem de canlı kamera modalından gelen File
  // listesini aynı işleme hattına sokar. Kamera modalı her çekimde tek File
  // gönderir; bu fonksiyon her çağrıda kendi worker'ını başlatır, çağrılar
  // arası paralelliği güvenlik görevlisinin tıklama hızı sınırlar.
  async function handleNewFiles(files) {
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
    busyCountRef.current += 1;
    setBusy(true);

    // 2 paralel upload. Makineler 2 CPU; 2 worker olsa da ayni makineye dusen
    // iki OCR 2 CPU'yu paylasip her biri ~2x yavasliyordu (p50 1.5s ama
    // p95 13.7s) → 15s timeout asiliyordu (2026-06-13 saha testi: 61 fotonun
    // 13'u Python OCR'da timeout). 2 paralel = ~makine basina 1 OCR, cekisme
    // yok, Python ~2-3s'de donuyor. MAX_CONCURRENT=4 idi.
    const MAX_CONCURRENT = 2;
    let cursor = 0;
    // Toplu yükleme sonu özeti için yerel sayaç — items state'i closure'da
    // bayat kaldığından sonuçları burada biriktiriyoruz.
    const sonuc = { okunan: 0, okunamayan: 0 };
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
        //
        // Sıkıştırma bazı fotoğraflarda (iPhone HEIC, çok büyük dosya, bozuk
        // görüntü, mobilde bellek baskısı) bir DOM Event ile reject ediyordu;
        // bu message'sız hata "Beklenmeyen hata." olarak görünüyordu. Artık
        // sıkıştırma başarısız olursa ORİJİNAL dosyayla devam ediyoruz
        // (backend 10MB'a kadar kabul eder) — upload bloke olmasın.
        let uploadFile;
        try {
          uploadFile = await imageCompression(item.file, {
            maxSizeMB: 0.4,
            maxWidthOrHeight: 1200,
            useWebWorker: true,
            initialQuality: 0.7,
          });
        } catch (compErr) {
          captureException(compErr, {
            asama: 'image-compression',
            fileName: item.file?.name,
            fileType: item.file?.type,
            fileSize: item.file?.size,
          });
          uploadFile = item.file; // orijinalle devam
        }

        updateItem(item.id, { durum: 'yükleniyor', uploadPct: 0 });

        const fd = new FormData();
        fd.append('foto', uploadFile, item.file.name);
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

        // Otomatik onay: plaka zaten DB'ye yazıldığı için onay yalnız UI
        // teyidi. Yüksek güvenli eşleşmelerde kullanıcıyı bekletme:
        //  - learned-exact / learned-signature (95-100): geçmişte onaylanmış
        //  - plate-recognizer skor >= 80: sahada %96+ isabet ölçüldü
        //  - fuzzy-registered skor >= 88: kayıtlı bir sakine yüksek-skorlu
        //    eşleşme (kamera çekimleri çoğunlukla bu yola düşüyordu; eşik
        //    yüksek tutuldu ki çok benzer iki kayıtlı plaka karışmasın).
        // Bunların dışındaki düşük güvenli okumalar manuel onayda kalır;
        // kullanıcı düzeltirse sistem öğrenmeye devam eder.
        const matchSource = ocr.match_source || '';
        const matchScore = ocr.match_score ?? 0;
        const otoOnay = !!plaka && !ocr.needs_manual_review && (
          matchSource.startsWith('learned')
          || (matchSource === 'plate-recognizer' && matchScore >= 80)
          || (matchSource === 'fuzzy-registered' && matchScore >= 88)
        );

        updateItem(item.id, {
          durum: otoOnay ? 'onaylandı' : 'kontrol bekliyor',
          otoOnay,
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
        if (plaka) sonuc.okunan += 1;
        else sonuc.okunamayan += 1;
      } catch (err) {
        // Gerçek hatayı Sentry'ye gönder — eskiden yutuluyordu, "Beklenmeyen
        // hata." dışında bir iz kalmıyordu, kök neden teşhis edilemiyordu.
        captureException(err, { asama: 'foto-upload', fileName: item.file?.name });
        updateItem(item.id, { durum: 'hata', hata: apiError(err) });
        sonuc.okunamayan += 1;
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, yeni.length) }, () => worker());
    await Promise.all(workers);

    busyCountRef.current -= 1;
    if (busyCountRef.current <= 0) {
      busyCountRef.current = 0;
      setBusy(false);
    }
    if (yeni.length > 1) {
      const mesaj = `${yeni.length} fotoğraf işlendi: ${sonuc.okunan} okundu, ${sonuc.okunamayan} okunamadı.`;
      if (sonuc.okunamayan > 0) toast.warning(mesaj);
      else toast.success(mesaj);
    }
    loadBugun();
  }

  function updateItem(id, patch) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  // Plakalar DB'de boşluksuz/büyük harf; aramayı da aynı forma sokarak
  // "34 abc 123" gibi yazımlar da eşleşsin. Daire filtresi de aynı normalize
  // (örn. "b 3" → "B3"). İki filtre AND'lenir, sonra seçili sıralama uygulanır.
  const aramaNorm = arama.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const daireNorm = daireArama.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const filtreAktif = !!(aramaNorm || daireNorm);
  const bugunFiltreli = bugun
    .filter((k) => {
      if (aramaNorm && !(k.plaka || '').includes(aramaNorm)) return false;
      if (daireNorm && !(k.daire_no || '').toUpperCase().includes(daireNorm)) return false;
      return true;
    })
    .sort(SIRALAYICILAR[siralama] || SIRALAYICILAR.zaman_desc);

  // Toplu yüklemede sabit bildirimdeki canlı sayaç — 100 fotoda durum
  // görmek için kaydırmak gerekmesin.
  const islenen = items.filter((i) => ['kontrol bekliyor', 'onaylandı', 'hata'].includes(i.durum));
  const okunanSayi = islenen.filter((i) => i.plaka).length;
  const okunamayanSayi = islenen.length - okunanSayi;

  async function onaylaPlaka(item) {
    const p = normalizePlaka(item.plaka);
    if (!isValidPlakaSerbest(p)) return toast.error('Plaka formatı geçersiz.');
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
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFiles}
            className="hidden"
            id="foto-input-gallery"
          />
          <Button
            size="xl"
            onClick={() => setKameraAcik(true)}
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
            <PhotoIcon className="w-6 h-6 mr-2" />
            Galeriden Yükle
          </Button>
          <Button variant="outline" size="xl" onClick={() => setManuelAcik(true)}>
            <PencilSquareIcon className="w-6 h-6 mr-2" />
            Elle Plaka Ekle
          </Button>
          <Link to="/kontrol/aksam" className="contents">
            <Button as="span" variant="success" size="xl" className="cursor-pointer">
              <ClipboardDocumentCheckIcon className="w-6 h-6 mr-2" />
              Akşam Kontrolünü Tamamla
            </Button>
          </Link>
        </div>
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
                        {it.durum === 'onaylandı' && it.otoOnay ? 'Otomatik Onaylandı' : durumInfo.label}
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
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase();
                          // Onaylanmış (otomatik dahil) kayıtta plaka değişirse
                          // onay durumunu geri al ki Onayla tekrar basılabilsin
                          // ve düzeltme PATCH ile öğrenmeye kaydedilsin.
                          updateItem(it.id, {
                            plaka: v,
                            ...(it.durum === 'onaylandı' && v !== it.plaka
                              ? { durum: 'kontrol bekliyor', otoOnay: false }
                              : {}),
                          });
                        }}
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
          Bugünün tüm yüklemeleri ({filtreAktif ? `${bugunFiltreli.length}/${bugun.length}` : bugun.length})
        </h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Plaka ara"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            icon={MagnifyingGlassIcon}
            className="font-mono uppercase"
            containerClassName="flex-1"
          />
          <Input
            placeholder="Daire (örn. B3)"
            value={daireArama}
            onChange={(e) => setDaireArama(e.target.value)}
            icon={BuildingIcon}
            className="font-mono uppercase"
            containerClassName="sm:w-44"
          />
          <Select
            value={siralama}
            onChange={(e) => setSiralama(e.target.value)}
            containerClassName="sm:w-48"
            aria-label="Sıralama"
          >
            <option value="zaman_desc">En yeni</option>
            <option value="zaman_asc">En eski</option>
            <option value="plaka_asc">Plaka A→Z</option>
            <option value="plaka_desc">Plaka Z→A</option>
            <option value="daire_asc">Daire A1→D34</option>
            <option value="daire_desc">Daire D34→A1</option>
          </Select>
        </div>
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
              {bugunFiltreli.map((k) => (
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
                      <div
                        className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center"
                        title="Elle giriş — foto yok"
                      >
                        <CarCartoonIcon className="w-12 h-12" />
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`font-mono font-semibold ${k.plaka ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'}`}>
                      {k.plaka || '—'}
                    </span>
                    {k.daire_no ? (
                      <span
                        className={`mt-1 flex w-fit items-center gap-1 text-[11px] font-medium rounded px-1.5 py-0.5 border ${
                          k.daire_misafir
                            ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800'
                        }`}
                        title={k.daire_misafir ? 'İçeride olan misafir aracı' : 'Plaka bu daireye kayıtlı'}
                      >
                        <BuildingIcon className="w-3 h-3" />
                        {k.daire_no}{k.daire_misafir ? ' · misafir' : ''}
                      </span>
                    ) : k.plaka ? (
                      <span
                        className="mt-1 flex w-fit items-center text-[11px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5"
                        title="Araç listesinde ve içerideki misafir listesinde yok"
                      >
                        kayıtsız
                      </span>
                    ) : null}
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
              {bugunFiltreli.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                      {filtreAktif ? (
                        <>
                          <MagnifyingGlassIcon className="w-8 h-8" />
                          <p>Filtreyle eşleşen kayıt yok.</p>
                        </>
                      ) : (
                        <>
                          <CameraIcon className="w-8 h-8" />
                          <p>Henüz yükleme yok.</p>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {busy && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-brand-900/90 backdrop-blur-sm text-white text-sm px-5 py-3 rounded-full shadow-xl flex items-center gap-3 animate-fade-in whitespace-nowrap">
          <LoadingSpinner className="w-5 h-5 shrink-0" />
          <span className="tabular-nums font-medium">{islenen.length}/{items.length}</span>
          <span className="text-green-300 tabular-nums">✓ {okunanSayi} okundu</span>
          {okunamayanSayi > 0 && (
            <span className="text-red-300 tabular-nums">✕ {okunamayanSayi} okunamadı</span>
          )}
        </div>
      )}

      {kameraAcik && (
        <CameraCapture
          onCapture={(file) => handleNewFiles([file])}
          onClose={() => setKameraAcik(false)}
        />
      )}

      {manuelAcik && (
        <ManuelPlakaModal
          onClose={() => setManuelAcik(false)}
          onSaved={() => { setManuelAcik(false); loadBugun(); }}
        />
      )}

      {/* zoomImage modal */}
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

// Canlı kamera ile seri çekim. Native <input capture> her çekimde kamerayı
// kapatıp tekrar açtırıyordu; güvenlik görevlisi yan yana duran araçları
// çekerken her foto için butona basmak zorunda kalıyordu. Bu modal
// getUserMedia ile canlı akış açar: "Çek" o anki kareyi yakalar, arka planda
// işleme hattına yollar, kamera AÇIK kalır → sıradakine hızlıca geçilir.
// "Bitti" akışı durdurup kapatır.
function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [hata, setHata] = useState(null);
  const [hazir, setHazir] = useState(false);
  const [sayac, setSayac] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let iptal = false;
    async function basla() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setHata('Bu cihaz/tarayıcı canlı kamerayı desteklemiyor. "Galeriden Yükle" ile foto seçebilirsiniz.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (iptal) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setHazir(true);
      } catch (err) {
        const ad = err?.name;
        if (ad === 'NotAllowedError' || ad === 'PermissionDeniedError') {
          setHata('Kamera izni reddedildi. Tarayıcı ayarlarından izin verip tekrar deneyin.');
        } else if (ad === 'NotFoundError' || ad === 'DevicesNotFoundError') {
          setHata('Kamera bulunamadı.');
        } else {
          setHata('Kamera açılamadı. "Galeriden Yükle" ile foto seçebilirsiniz.');
        }
      }
    }
    basla();
    return () => {
      iptal = true;
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function cek() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `kamera_${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
        setSayac((n) => n + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 160);
      },
      'image/jpeg',
      0.92
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Üst bar: sayaç + Bitti */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/70 to-transparent">
        <div className="text-white/90 text-sm font-medium">
          {sayac > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 tabular-nums">
              <span className="w-2 h-2 bg-green-400 rounded-full" />
              {sayac} çekildi
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white font-semibold rounded-full px-4 py-2"
        >
          <CheckIcon className="w-5 h-5" />
          Bitti
        </button>
      </div>

      {/* Görüntü / hata */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {hata ? (
          <div className="text-center text-white/90 p-8 max-w-sm">
            <CameraIcon className="w-12 h-12 mx-auto mb-3 opacity-60" />
            <p className="text-sm">{hata}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 bg-white/15 hover:bg-white/25 rounded-full px-5 py-2 font-semibold text-white"
            >
              Kapat
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
            />
            {/* Plaka çerçeve kılavuzu + dışını hafif karart */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[78%] max-w-md aspect-[4/1.3] border-2 border-white/70 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
            <div className="pointer-events-none absolute top-20 inset-x-0 text-center text-white/80 text-xs px-6">
              Plakayı çerçeveye düz ve yakın yerleştirin
            </div>
            {flash && <div className="absolute inset-0 bg-white/80" />}
            {!hazir && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <LoadingSpinner className="w-8 h-8 text-white" />
              </div>
            )}
          </>
        )}
      </div>

      {/* Alt bar: deklanşör */}
      {!hata && (
        <div className="absolute bottom-0 inset-x-0 z-10 flex items-center justify-center pb-8 pt-10 bg-gradient-to-t from-black/70 to-transparent">
          <button
            type="button"
            onClick={cek}
            disabled={!hazir}
            aria-label="Çek"
            className="w-20 h-20 rounded-full bg-white/95 active:scale-90 transition-transform disabled:opacity-40 ring-4 ring-white/40 flex items-center justify-center"
          >
            <span className="w-16 h-16 rounded-full bg-white border-4 border-slate-300" />
          </button>
        </div>
      )}
    </div>
  );
}

// Foto çekilemeyen durumlar için manuel plaka girişi. Kayıt foto olmadan
// oluşur; listede karikatür araba placeholder'ı ile görünür ve akşam
// analizine normal kayıt gibi dahil olur.
function ManuelPlakaModal({ onClose, onSaved }) {
  const toast = useToast();
  const [plaka, setPlaka] = useState('');
  const [busy, setBusy] = useState(false);

  async function kaydet() {
    const p = normalizePlaka(plaka);
    if (!isValidPlakaSerbest(p)) return toast.error('Plaka formatı geçersiz.');
    setBusy(true);
    try {
      await api.post('/kontroller/manuel', { plaka: p });
      toast.success(`${p} elle eklendi.`);
      onSaved();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-4 border border-transparent dark:border-slate-800 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Elle Plaka Ekle</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex justify-center py-2 bg-slate-50 dark:bg-slate-800 rounded-xl">
          <CarCartoonIcon className="w-28 h-20" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Fotoğraf çekilemeyen araçlar için plakayı elle girin. Kayıt akşam
          kontrolü analizine dahil edilir.
        </p>
        <Input
          value={plaka}
          onChange={(e) => setPlaka(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') kaydet(); }}
          placeholder="34ABC123"
          className="font-mono text-lg"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>İptal</Button>
          <Button onClick={kaydet} disabled={busy} loading={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </div>
  );
}
