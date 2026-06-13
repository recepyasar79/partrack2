import { useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { icerideMi } from '../utils/misafir';

export default function AksamKontrolu() {
  const toast = useToast();
  const [sonuc, setSonuc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gonderimYukleniyor, setGonderimYukleniyor] = useState({});

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
    </div>
  );
}
