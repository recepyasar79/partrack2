import { useEffect, useState } from 'react';
import { api, apiError } from '../services/api';
import { useToast } from './ui/Toast';

/**
 * Daire'nin eski sahipleri listesi (Faz Ü4 — KVKK uyumlu görüntüleme).
 *
 * site_yonetici dışındaki rollerde telefon maskelenir (backend yapar);
 * burada gelen veri olduğu gibi gösterilir.
 */
export default function SahipTarihce({ daireId }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setItems(null);
    setOpen(false);
  }, [daireId]);

  async function load() {
    try {
      const { data } = await api.get(`/daireler/${daireId}/sahip-tarihce`);
      setItems(data.tarihce);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  }

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
      <button
        type="button"
        onClick={toggle}
        className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 flex items-center gap-1.5"
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        Eski Sahipler {items && items.length > 0 ? `(${items.length})` : ''}
      </button>

      {open && (
        <div className="mt-3">
          {items === null ? (
            <div className="text-xs text-slate-400">Yükleniyor…</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-slate-400 italic">Eski sahip kaydı yok.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {items.map((t) => (
                <li
                  key={t.id}
                  className="bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                >
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{t.sahip_ad}</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">📞 {t.sahip_tel}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {fmtDate(t.baslangic_tarihi)} – {fmtDate(t.bitis_tarihi)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('tr-TR');
}
