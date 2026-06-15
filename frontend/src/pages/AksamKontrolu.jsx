import { useState, useEffect } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { XMarkIcon, LoadingSpinner, MagnifyingGlassIcon } from '../components/ui/Icons';
import { icerideMi } from '../utils/misafir';

export default function AksamKontrolu() {
  const toast = useToast();
  const [sonuc, setSonuc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gonderimYukleniyor, setGonderimYukleniyor] = useState({});
  const [ceteleAcik, setCeteleAcik] = useState(false);

  function isBefore20() {
    return new Date().getHours() < 20;
  }

  async function tamamla() {
    if (isBefore20()) {
      const ok = window.confirm(
        'Henüz akşam kontrolü saati (20:00) gelmedi. Yine de devam etmek istiyor musunuz?'
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/kontroller/analiz-et', {});
      setSonuc(data);
      const yeni = data.yeni_ihlaller?.length || 0;
      const guncel = data.guncellenen_ihlaller?.length || 0;
      toast.success(`Analiz tamam: ${yeni} yeni ihlal, ${guncel} güncellenen.`);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  }

  async function gonder(ihlalId) {
    setGonderimYukleniyor((s) => ({ ...s, [ihlalId]: true }));
    try {
      await api.post('/bildirimler/gonder', { ihlal_id: ihlalId });
      toast.success('Bildirim gönderildi.');
      await tekrarYukle();
    } catch (e) { toast.error(apiError(e)); }
    finally { setGonderimYukleniyor((s) => ({ ...s, [ihlalId]: false })); }
  }

  async function topluGonder() {
    const ids = (sonuc?.ihlaller || [])
      .filter((i) => i.bildirim_opt_in && i.ihlal_id)
      .map((i) => i.ihlal_id);
    if (!ids.length) return toast.info('Opt-in onayı olan yeni ihlal yok.');
    if (!window.confirm(`${ids.length} kişiye WhatsApp bildirimi gönderilsin mi?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/bildirimler/toplu-gonder', { ihlal_idleri: ids });
      toast.success(`${data.basari} gönderildi, ${data.hata} hata.`);
      await tekrarYukle();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  }

  async function tekrarYukle() {
    try {
      const { data } = await api.post('/kontroller/analiz-et', {});
      setSonuc(data);
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Akşam Kontrolü</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Bugünkü plakaları analiz et, ihlalleri tespit et, daire sahiplerine WhatsApp gönder.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4 flex flex-col gap-3">
        <Button size="lg" onClick={tamamla} disabled={busy}>
          {busy ? 'Analiz ediliyor…' : '✓ Akşam Kontrolünü Tamamla'}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => setCeteleAcik(true)}>
          🌙 Gece Çetelesi
        </Button>
        {isBefore20() && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded p-2">
            Resmi kontrol saati 20:00'dir. Bu saatten önce çalıştırırsanız uyarı gelecektir.
          </p>
        )}
      </div>

      {sonuc && (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">İhlaller ({sonuc.ihlaller.length})</h2>
              {sonuc.ihlaller.some((i) => i.bildirim_opt_in) && (
                <Button size="sm" onClick={topluGonder} disabled={busy}>
                  Toplu WhatsApp Gönder
                </Button>
              )}
            </div>
            {sonuc.ihlaller.length === 0 ? (
              <p className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded p-3">
                Bugün için ihlal yok. 🎉
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {sonuc.ihlaller.map((i) => (
                  <li key={i.daire_id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {i.daire_no} — {i.sahip_ad}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {i.sahip_tel} · {i.bildirim_opt_in ? 'Opt-in ✓' : 'Opt-in yok'}
                        {i.yeni_eklendi && <span className="ml-2 text-blue-600 dark:text-blue-300 font-semibold">YENİ</span>}
                      </div>
                      <div className="text-sm font-mono mt-1 flex flex-wrap gap-2 text-slate-700 dark:text-slate-200">
                        {i.plakalar.map((p) => (
                          <span key={p} className="inline-flex items-center gap-1">
                            {p}
                            {i.misafir_plakalar?.includes(p) && (
                              <span className="font-sans text-[11px] bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1">
                                misafir
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={i.bildirim_opt_in ? 'primary' : 'secondary'}
                      disabled={!i.bildirim_opt_in || !i.ihlal_id || gonderimYukleniyor[i.ihlal_id]}
                      onClick={() => i.ihlal_id && gonder(i.ihlal_id)}
                      title={!i.bildirim_opt_in ? 'Daire WhatsApp bildirimine onay vermemiş' : ''}
                    >
                      {gonderimYukleniyor[i.ihlal_id] ? 'Gönderiliyor…' : 'WhatsApp Gönder'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {sonuc.misafir_gorulen?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2 flex-wrap text-slate-900 dark:text-slate-100">
                <span>Misafir Araçlar (Bugün Görülen)</span>
                <span className="text-xs font-normal bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5">
                  {sonuc.misafir_gorulen.length}
                </span>
                {sonuc.misafir_gorulen.some((m) => icerideMi(m)) && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full px-2 py-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    İçeride: {sonuc.misafir_gorulen.filter((m) => icerideMi(m)).length}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Bu araçlar misafir muafiyeti kapsamındadır, ihlal sayılmaz.
              </p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {sonuc.misafir_gorulen.map((m) => {
                  const iceride = icerideMi(m);
                  return (
                  <li
                    key={`${m.daire_id}-${m.plaka}`}
                    className={`py-2 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 ${
                      iceride ? 'border-l-4 border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/20 pl-2 -ml-px rounded-r' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">{m.plaka}</span>
                        <span className="text-[11px] bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
                          misafir
                        </span>
                        {iceride && (
                          <span className="text-[11px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded px-1.5 py-0.5">
                            İçeride
                          </span>
                        )}
                        <span className="text-xs text-slate-600 dark:text-slate-300">→ {m.daire_no} ({m.sahip_ad})</span>
                      </div>
                      {(m.aciklama || m.olusturma_zamani) && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {m.aciklama && <span className="italic">"{m.aciklama}"</span>}
                          {m.olusturma_zamani && (
                            <span className="text-slate-400 dark:text-slate-500">
                              · kaydedildi: {new Date(m.olusturma_zamani).toLocaleString('tr-TR', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                      {String(m.baslangic_tarihi).slice(0, 10)} → {String(m.bitis_tarihi).slice(0, 10)}
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}

          {sonuc.kayitsiz_plakalar?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4">
              <h3 className="font-semibold mb-2 text-slate-900 dark:text-slate-100">Kayıtsız Plakalar ({sonuc.kayitsiz_plakalar.length})</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Site sakinine ait olmayan veya henüz tanımlanmamış plakalar.
              </p>
              <div className="flex flex-wrap gap-2">
                {sonuc.kayitsiz_plakalar.map((p) => (
                  <span key={p} className="font-mono text-sm bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {ceteleAcik && <GeceCetelesiModal onClose={() => setCeteleAcik(false)} />}
    </div>
  );
}

// "Gece Çetelesi" — akşam kontrolü sonrası daire bazlı canlı araç sayacı.
// Açılışta sunucu akşam tespitinden tohumlar; güvenlik görevlisi gece boyu
// araç giriş/çıkışında daireye dokunup +/- ile sayacı günceller. Renk: 0 pasif,
// 1 sarı, 2 kırmızı, 3+ koyu kırmızı. Durum sunucuda (yenileme/cihaz dayanıklı).
function ceteleRenk(n) {
  if (n >= 3) return 'bg-red-800 text-red-50 border-red-900 hover:bg-red-700';      // koyu kırmızı
  if (n === 2) return 'bg-red-500 text-white border-red-600 hover:bg-red-400';      // kırmızı
  if (n === 1) return 'bg-amber-400 text-amber-950 border-amber-500 hover:bg-amber-300'; // sarı
  return 'bg-slate-200 text-slate-500 border-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600'; // pasif
}

function GeceCetelesiModal({ onClose }) {
  const toast = useToast();
  const [daireler, setDaireler] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [seciliId, setSeciliId] = useState(null);
  const [arama, setArama] = useState('');
  const [guncellenen, setGuncellenen] = useState(null); // o an PATCH'lenen daire_id

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const { data } = await api.get('/kontroller/gece-cetelesi');
        if (!iptal) setDaireler(data.daireler || []);
      } catch (e) {
        if (!iptal) toast.error(apiError(e));
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    })();
    return () => { iptal = true; };
  }, []); // eslint-disable-line

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const secili = daireler.find((d) => d.daire_id === seciliId) || null;

  async function degistir(daireId, delta) {
    setGuncellenen(daireId);
    try {
      const { data } = await api.patch(`/kontroller/gece-cetelesi/${daireId}`, { delta });
      setDaireler((prev) => prev.map((d) =>
        d.daire_id === daireId ? { ...d, arac_sayisi: data.arac_sayisi } : d
      ));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setGuncellenen(null);
    }
  }

  // Sayaçları akşam kontrolündeki tespit değerlerine geri al (gece boyu yapılan
  // manuel +/- değişiklikleri siler). Tohum bir nedenle yanlış/eksik kaldıysa
  // (ör. ekran erken açılmış) güvenlik görevlisinin elle düzeltme yolu.
  async function yenile() {
    if (!window.confirm(
      'Sayaçlar akşam kontrolündeki tespit değerlerine sıfırlanacak.\n'
      + 'Gece boyu yaptığınız +/- değişiklikler silinir. Devam edilsin mi?'
    )) return;
    setYukleniyor(true);
    try {
      const { data } = await api.get('/kontroller/gece-cetelesi?yenile=1');
      setDaireler(data.daireler || []);
      setSeciliId(null);
      toast.success('Akşam tespitinden yenilendi.');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setYukleniyor(false);
    }
  }

  // Blok bazında grupla (liste zaten blok+sıra sıralı geliyor).
  const aramaNorm = arama.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const filtreli = aramaNorm
    ? daireler.filter((d) => (d.daire_no || '').toUpperCase().includes(aramaNorm))
    : daireler;
  const bloklar = [];
  for (const d of filtreli) {
    let grup = bloklar.find((b) => b.blok === d.blok);
    if (!grup) { grup = { blok: d.blok, daireler: [] }; bloklar.push(grup); }
    grup.daireler.push(d);
  }

  const toplamIceride = daireler.reduce((s, d) => s + (d.arac_sayisi || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
      <div className="bg-white dark:bg-slate-900 flex-1 flex flex-col mt-0 sm:mt-6 sm:mx-auto sm:max-w-3xl sm:rounded-t-2xl overflow-hidden">
        {/* Üst bar */}
        <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">🌙 Gece Çetelesi</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              İçeride toplam <span className="font-semibold tabular-nums">{toplamIceride}</span> araç ·
              daireye dokun, +/- ile güncelle
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Renk lejantı + yenile + arama */}
        <div className="px-4 pt-3 shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 dark:bg-slate-600" /> 0 (boş)</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> 1</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> 2</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-800" /> 3+</span>
            </div>
            <button
              type="button"
              onClick={yenile}
              disabled={yukleniyor}
              className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline disabled:opacity-50 whitespace-nowrap"
              title="Sayaçları akşam tespitine sıfırla"
            >
              ↻ Akşam tespitinden yenile
            </button>
          </div>
          <Input
            placeholder="Daire ara (örn. B17)"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            icon={MagnifyingGlassIcon}
            className="font-mono uppercase"
          />
        </div>

        {/* Daire ızgarası */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {yukleniyor ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <LoadingSpinner className="w-7 h-7" />
            </div>
          ) : bloklar.length === 0 ? (
            <p className="text-center text-slate-400 dark:text-slate-500 py-10 text-sm">Daire bulunamadı.</p>
          ) : (
            bloklar.map((grup) => (
              <div key={grup.blok}>
                <div className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{grup.blok} Blok</div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {grup.daireler.map((d) => (
                    <button
                      key={d.daire_id}
                      type="button"
                      onClick={() => setSeciliId(d.daire_id)}
                      className={`relative min-h-[48px] rounded-lg border text-sm font-bold font-mono transition-colors ${ceteleRenk(d.arac_sayisi)} ${
                        seciliId === d.daire_id ? 'ring-2 ring-offset-1 ring-brand-500 dark:ring-offset-slate-900' : ''
                      }`}
                    >
                      {d.daire_no}
                      {d.arac_sayisi > 0 && (
                        <span className="absolute top-0.5 right-1 text-[10px] font-extrabold tabular-nums opacity-80">
                          {d.arac_sayisi}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Alt kontrol — seçili daire için +/- */}
        {secili && (
          <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center gap-3 animate-slide-up">
            <div className="flex-1">
              <div className="font-mono font-bold text-lg text-slate-900 dark:text-slate-100">{secili.daire_no}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                İçeride: <span className="font-semibold tabular-nums">{secili.arac_sayisi}</span> araç
              </div>
            </div>
            <button
              type="button"
              onClick={() => degistir(secili.daire_id, -1)}
              disabled={secili.arac_sayisi <= 0 || guncellenen === secili.daire_id}
              aria-label="Azalt"
              className="w-14 h-14 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-3xl font-bold flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => degistir(secili.daire_id, 1)}
              disabled={guncellenen === secili.daire_id}
              aria-label="Artır"
              className="w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-500 text-white text-3xl font-bold flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setSeciliId(null)}
              aria-label="Paneli kapat"
              className="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
