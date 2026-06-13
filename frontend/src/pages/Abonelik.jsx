import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, apiError } from '../services/api';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';

// Frontend ↔ backend pricing senkron — backend utils/pricing.js ile aynı sayılar.
const PLAN_PRICES = {
  baslangic: { monthly: 0, yearly: 0 },
  standart:  { monthly: 99900, yearly: 959040 },
  pro:       { monthly: 159900, yearly: 1535040 },
  kurumsal:  { monthly: null,  yearly: null  },
};

const PLAN_DETAYLAR = {
  baslangic: {
    ad: 'Başlangıç',
    desc: 'Küçük siteler için ücretsiz',
    limits: { daire: 50, user: 5 },
    features: ['50 daire', '5 kullanıcı', 'Temel OCR', 'Topluluk desteği'],
  },
  standart: {
    ad: 'Standart',
    desc: 'Orta büyüklükteki siteler için',
    limits: { daire: 200, user: 20 },
    features: ['200 daire', '20 kullanıcı', 'Yüksek doğruluk OCR', 'E-posta desteği', 'WhatsApp bildirim'],
  },
  pro: {
    ad: 'Pro',
    desc: 'Büyük siteler için',
    limits: { daire: 500, user: 50 },
    features: ['500 daire', '50 kullanıcı', 'Plate Recognizer entegrasyonu', 'Öncelikli destek', 'Aylık rapor'],
    populer: true,
  },
  kurumsal: {
    ad: 'Kurumsal',
    desc: 'Site zincirleri ve yönetim şirketleri için',
    limits: { daire: '∞', user: '∞' },
    features: ['Sınırsız daire/kullanıcı', 'Özel SLA', 'Self-hosted seçeneği', 'Atanmış müşteri temsilcisi'],
  },
};

function formatTRY(kurus) {
  if (kurus == null) return null;
  return (kurus / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0 });
}

function StatusBadge({ status, cancel_at_period_end }) {
  if (cancel_at_period_end) {
    return <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs">Period sonu iptal</span>;
  }
  const map = {
    active: { cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', label: 'Aktif' },
    past_due: { cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'Ödeme bekleniyor' },
    suspended: { cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300', label: 'Askıda' },
    cancelled: { cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400', label: 'İptal' },
  };
  const m = map[status] || { cls: '', label: status };
  return <span className={`px-2 py-0.5 rounded-full text-xs ${m.cls}`}>{m.label}</span>;
}

function InvoiceStatusBadge({ status }) {
  const map = {
    paid: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    pending: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    failed: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
    refunded: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
    draft: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
  };
  const labels = { paid: 'Ödendi', pending: 'Bekliyor', failed: 'Başarısız', refunded: 'İade', draft: 'Taslak' };
  return <span className={`px-2 py-0.5 rounded text-xs ${map[status] || ''}`}>{labels[status] || status}</span>;
}

export default function Abonelik() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null); // { subscription, invoices }
  const [cycle, setCycle] = useState('monthly');
  const [submitting, setSubmitting] = useState(false);

  const currentPlan = data?.subscription?.plan || user?.site?.plan || 'baslangic';
  const currentCycle = data?.subscription?.billing_cycle || 'monthly';

  useEffect(() => {
    if (user?.rol !== 'site_yonetici') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.get('/site/subscription')
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.rol]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reload() {
    const r = await api.get('/site/subscription');
    setData(r.data);
    await refresh();
  }

  async function startSubscription(plan) {
    if (!confirm(`${PLAN_DETAYLAR[plan].ad} planına abone olunacak. Devam?`)) return;
    setSubmitting(true);
    try {
      await api.post('/site/subscription', { plan, cycle });
      toast.success(`${PLAN_DETAYLAR[plan].ad} planı başlatıldı.`);
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function changePlan(plan) {
    if (!confirm(`Planınız "${PLAN_DETAYLAR[plan].ad}" olarak değişecek. Pro-rate ek tahsilat veya credit uygulanır. Devam?`)) return;
    setSubmitting(true);
    try {
      const r = await api.patch('/site/subscription/plan', { plan });
      const msg = r.data.prorate?.message || 'Plan güncellendi';
      toast.success(msg);
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!confirm('Aboneliğiniz dönem sonunda sona erecek. Devam?')) return;
    setSubmitting(true);
    try {
      await api.post('/site/subscription/cancel');
      toast.success('Abonelik dönem sonunda sona erecek.');
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function reactivate() {
    setSubmitting(true);
    try {
      await api.post('/site/subscription/reactivate');
      toast.success('İptal kararı geri alındı.');
      await reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  const planCards = useMemo(() => {
    return Object.entries(PLAN_DETAYLAR).map(([key, info]) => {
      const price = PLAN_PRICES[key][cycle];
      return { key, info, price };
    });
  }, [cycle]);

  if (user?.rol !== 'site_yonetici') {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <div className="bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-amber-700 dark:text-amber-300">
          Abonelik yönetimi yalnızca site yöneticilerine açıktır.
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-500">Yükleniyor...</div>;
  }

  const sub = data?.subscription;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Abonelik</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Site planınızı, faturalama döneminizi ve geçmiş faturalarınızı buradan yönetin.
        </p>
      </div>

      {/* Mevcut Abonelik Kartı */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Mevcut plan</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {PLAN_DETAYLAR[currentPlan]?.ad || currentPlan}
            </div>
            {sub && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={sub.status} cancel_at_period_end={sub.cancel_at_period_end} />
                <span className="text-slate-500 dark:text-slate-400">
                  {sub.billing_cycle === 'yearly' ? 'Yıllık' : 'Aylık'} • Dönem sonu: {new Date(sub.current_period_end).toLocaleDateString('tr-TR')}
                </span>
              </div>
            )}
            {!sub && currentPlan === 'baslangic' && (
              <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Ücretsiz başlangıç planı — abonelik gerekmez.</div>
            )}
          </div>
          {sub && (
            <div className="flex gap-2">
              {sub.cancel_at_period_end ? (
                <Button onClick={reactivate} disabled={submitting} variant="primary">İptali Geri Al</Button>
              ) : (
                <Button onClick={cancel} disabled={submitting} variant="secondary">İptal Et</Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Plan Seçim Kartları */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Plan Seçenekleri</h2>
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm">
            <button
              className={`px-3 py-1 rounded-md font-medium transition ${cycle === 'monthly' ? 'bg-white dark:bg-slate-900 shadow text-brand-600' : 'text-slate-500'}`}
              onClick={() => setCycle('monthly')}
            >Aylık</button>
            <button
              className={`px-3 py-1 rounded-md font-medium transition ${cycle === 'yearly' ? 'bg-white dark:bg-slate-900 shadow text-brand-600' : 'text-slate-500'}`}
              onClick={() => setCycle('yearly')}
            >Yıllık <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700">-%20</span></button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {planCards.map(({ key, info, price }) => {
            const isCurrent = currentPlan === key && (!sub || sub.billing_cycle === cycle);
            const canUpgrade = !!sub && key !== currentPlan && key !== 'kurumsal';
            const canSubscribe = !sub && key !== 'baslangic' && key !== 'kurumsal';
            return (
              <div
                key={key}
                className={`rounded-2xl p-5 border-2 transition flex flex-col ${
                  isCurrent
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : info.populer
                      ? 'border-brand-300 dark:border-brand-700 bg-white dark:bg-slate-900'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                {info.populer && !isCurrent && (
                  <div className="self-start mb-2 text-[10px] uppercase tracking-wide bg-brand-500 text-white px-2 py-0.5 rounded-full">Popüler</div>
                )}
                <div className="font-bold text-lg text-slate-900 dark:text-slate-100">{info.ad}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">{info.desc}</div>
                <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {price == null ? 'Özel' : price === 0 ? 'Ücretsiz' : formatTRY(price)}
                </div>
                {price > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {cycle === 'yearly' ? '/yıl (KDV hariç)' : '/ay (KDV hariç)'}
                  </div>
                )}
                <ul className="mt-4 space-y-1.5 text-sm text-slate-600 dark:text-slate-300 flex-1">
                  {info.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <Button disabled className="w-full" variant="secondary">Mevcut Plan</Button>
                  ) : key === 'kurumsal' ? (
                    <a
                      href="mailto:sales@parktrack.example?subject=Kurumsal Plan Talebi"
                      className="block text-center w-full px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-medium"
                    >Bize Ulaşın</a>
                  ) : canUpgrade ? (
                    <Button onClick={() => changePlan(key)} disabled={submitting} className="w-full">
                      {key === 'baslangic' ? 'Düşür' : 'Geç'}
                    </Button>
                  ) : canSubscribe ? (
                    <Button onClick={() => startSubscription(key)} disabled={submitting} className="w-full">Abone Ol</Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fatura Geçmişi */}
      {data?.invoices?.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">Fatura Geçmişi</h2>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="text-left p-3 font-medium">Fatura No</th>
                  <th className="text-left p-3 font-medium">Tarih</th>
                  <th className="text-left p-3 font-medium">Dönem</th>
                  <th className="text-right p-3 font-medium">Tutar</th>
                  <th className="text-center p-3 font-medium">Durum</th>
                  <th className="text-center p-3 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-3 font-mono text-xs">{inv.invoice_no}</td>
                    <td className="p-3">{new Date(inv.issued_at).toLocaleDateString('tr-TR')}</td>
                    <td className="p-3 text-xs text-slate-500">
                      {new Date(inv.period_start).toLocaleDateString('tr-TR')} → {new Date(inv.period_end).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">{formatTRY(inv.amount_incl_tax)}</td>
                    <td className="p-3 text-center"><InvoiceStatusBadge status={inv.status} /></td>
                    <td className="p-3 text-center">
                      {inv.pdf_url ? <a className="text-brand-600 hover:underline text-xs" href={inv.pdf_url} target="_blank" rel="noreferrer">İndir</a> : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
