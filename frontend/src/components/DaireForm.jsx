import { useMemo, useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { isValidTelefon, formatTelefon, unformatTelefon } from '../utils/validation';
import { KVKK_METNI } from '../utils/constants';
import { useAuth } from '../auth/AuthContext';

// Site'nin blok_yapisi'sından daire_no listesi üretir.
// Örn: [{ad: "A", daire_sayisi: 34}] → ["A1", "A2", ..., "A34"]
function buildDaireList(blokYapisi) {
  if (!Array.isArray(blokYapisi)) return [];
  const out = [];
  for (const b of blokYapisi) {
    const ad = String(b.ad || '').trim();
    const n = parseInt(b.daire_sayisi, 10);
    if (!ad || !Number.isInteger(n)) continue;
    for (let i = 1; i <= n; i++) out.push(`${ad}${i}`);
  }
  return out;
}

export default function DaireForm({ initial = {}, onSubmit, busy }) {
  const { user } = useAuth();
  const daireList = useMemo(() => buildDaireList(user?.site?.blok_yapisi), [user?.site?.blok_yapisi]);
  const [daire_no, setDaireNo] = useState(initial.daire_no || '');
  const [sahip_ad, setSahipAd] = useState(initial.sahip_ad || '');
  const [sahip_tel, setSahipTel] = useState(formatTelefon(initial.sahip_tel || ''));
  const [kvkk_riza, setKvkk] = useState(!!initial.kvkk_riza);
  const [bildirim_opt_in, setOptIn] = useState(!!initial.bildirim_opt_in);
  const [showKvkkText, setShowKvkkText] = useState(false);
  const [errors, setErrors] = useState({});

  const isEdit = !!initial.id;

  function validate() {
    const e = {};
    if (!isEdit && !daireList.includes(daire_no)) e.daire_no = 'Daire numarası seçin.';
    if (!sahip_ad || sahip_ad.trim().length < 2) e.sahip_ad = 'Ad-soyad en az 2 karakter.';
    if (!isValidTelefon(unformatTelefon(sahip_tel))) e.sahip_tel = 'Telefon 05XXXXXXXXX formatında olmalı.';
    if (!isEdit && !kvkk_riza) e.kvkk_riza = 'KVKK rızası zorunludur.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handle(e) {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit({
      daire_no,
      sahip_ad: sahip_ad.trim(),
      sahip_tel: unformatTelefon(sahip_tel),
      kvkk_riza,
      bildirim_opt_in,
    });
  }

  return (
    <form onSubmit={handle} className="flex flex-col gap-3 bg-white dark:bg-slate-900 rounded-2xl shadow dark:shadow-black/30 border border-transparent dark:border-slate-800 p-4">
      {!isEdit && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Daire</label>
          <select
            value={daire_no}
            onChange={(e) => setDaireNo(e.target.value)}
            className="min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800"
          >
            <option value="">Daire seçin…</option>
            {daireList.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          {errors.daire_no && <span className="text-sm text-red-600 dark:text-red-400">{errors.daire_no}</span>}
        </div>
      )}
      <Input
        label="Ad Soyad"
        value={sahip_ad}
        onChange={(e) => setSahipAd(e.target.value)}
        error={errors.sahip_ad}
      />
      <Input
        label="Telefon"
        inputMode="numeric"
        placeholder="0555 123 45 67"
        value={sahip_tel}
        onChange={(e) => setSahipTel(formatTelefon(e.target.value))}
        error={errors.sahip_tel}
      />

      <div className="flex flex-col gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={kvkk_riza}
            onChange={(e) => setKvkk(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span>
            <strong>KVKK Açık Rızası</strong> — Kişisel verilerimin (ad, telefon, plaka) site
            otopark yönetimi amacıyla işlenmesini kabul ediyorum.{' '}
            <button
              type="button"
              onClick={() => setShowKvkkText((s) => !s)}
              className="text-blue-600 dark:text-blue-400 underline"
            >
              {showKvkkText ? 'gizle' : 'metni göster'}
            </button>
          </span>
        </label>
        {showKvkkText && (
          <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">
            {KVKK_METNI}
            {' '}
            <a href="/kvkk" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
              Tam metni okuyun →
            </a>
          </p>
        )}
        {errors.kvkk_riza && <span className="text-sm text-red-600 dark:text-red-400">{errors.kvkk_riza}</span>}
      </div>

      <label className="flex items-start gap-2 text-sm bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={bildirim_opt_in}
          onChange={(e) => setOptIn(e.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <span>
          İhlal durumunda <strong>WhatsApp ile bilgilendirilmeyi</strong> kabul ediyorum (opsiyonel).
        </span>
      </label>

      <Button type="submit" disabled={busy}>
        {busy ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Daire Ekle'}
      </Button>
    </form>
  );
}
