/**
 * Plan fiyatlandırma yardımcıları (Faz Ü3.1).
 *
 * Tüm tutarlar KURUŞ cinsinden integer olarak saklanır — floating
 * point yuvarlama sorunlarından kaçınmak için. UI tarafında /100
 * ederek TL gösterilir.
 *
 * Yıllık fiyat = aylık × 12 × (1 - YEARLY_DISCOUNT). %20 indirim.
 *
 * KDV %20 (Türkiye 2026 standart oran).
 *
 * baslangic planı ÜCRETSİZ — abonelik gerekmez, sites tablosundaki
 * plan='baslangic' ile yaşar. subscriptions kaydı bile gerekmez
 * (sub_id NULL yaşayabilir). Ücretli planlara geçince subscription
 * oluşur.
 */

const TAX_RATE = 20; // % — Türkiye 2026 KDV
const YEARLY_DISCOUNT = 0.20; // %20 yıllık indirim

// Aylık fiyatlar (kuruş, KDV hariç)
const MONTHLY_PRICES = {
  baslangic: 0,
  standart: 29900,   // 299 TL/ay
  pro:      79900,   // 799 TL/ay
  kurumsal: null,    // Özel anlaşma — kod yolu açma, sales-driven
};

const VALID_PLANS = ['baslangic', 'standart', 'pro', 'kurumsal'];
const VALID_CYCLES = ['monthly', 'yearly'];

/**
 * Belirli plan + cycle için brüt (KDV hariç) tutar — kuruş.
 *
 * @param {string} plan
 * @param {string} cycle - 'monthly' veya 'yearly'
 * @returns {number|null} Kuruş; kurumsal için null (özel teklif)
 */
function getBaseAmount(plan, cycle) {
  const monthly = MONTHLY_PRICES[plan];
  if (monthly == null) return null;
  if (cycle === 'monthly') return monthly;
  if (cycle === 'yearly') {
    // 12 ay × (1 - indirim), aşağı yuvarla
    return Math.floor(monthly * 12 * (1 - YEARLY_DISCOUNT));
  }
  return null;
}

/**
 * KDV dahil son tutar (kuruş). Banker's rounding değil, Math.round
 * kullanılır — fatura okumuşı için.
 *
 * @param {number} amountExclTax  Kuruş, KDV hariç
 * @param {number} [taxRate]      Yüzde (default 20)
 * @returns {{amount_excl_tax: number, tax_rate: number, tax: number, amount_incl_tax: number}}
 */
function calculateTotal(amountExclTax, taxRate = TAX_RATE) {
  if (amountExclTax == null || amountExclTax < 0) {
    throw new Error('amountExclTax negatif veya null olamaz');
  }
  const tax = Math.round(amountExclTax * taxRate / 100);
  return {
    amount_excl_tax: amountExclTax,
    tax_rate: taxRate,
    tax,
    amount_incl_tax: amountExclTax + tax,
  };
}

/**
 * Plan değişimi pro-rate hesabı.
 *
 * Senaryo: kullanıcı dönem ortasında daha pahalı plana geçer.
 * - Eski plandan kalan günlerin değeri = (yeni_aylık - eski_aylık) × kalan_gün / dönem_uzunluk
 * - Daha ucuz plana geçişte credit oluşur (sonraki faturayı düşürür) veya 0.
 *
 * Bu fonksiyon SADECE TUTAR FARKINI hesaplar — pozitif = ek tahsilat,
 * negatif = credit (faturalandırma yerine sonraki faturadan düş).
 *
 * @param {object} params
 * @param {string} params.fromPlan
 * @param {string} params.toPlan
 * @param {string} params.cycle - 'monthly' veya 'yearly'
 * @param {Date|string} params.periodStart
 * @param {Date|string} params.periodEnd
 * @param {Date|string} [params.now] - Test için override; default new Date()
 * @returns {number} Kuruş cinsinden fark (KDV hariç). Pozitif=tahsilat, negatif=credit.
 */
function prorateChange({ fromPlan, toPlan, cycle, periodStart, periodEnd, now }) {
  const fromAmount = getBaseAmount(fromPlan, cycle) || 0;
  const toAmount = getBaseAmount(toPlan, cycle) || 0;
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  const current = (now ? new Date(now) : new Date()).getTime();
  if (end <= start) return 0;
  const totalMs = end - start;
  const remainingMs = Math.max(0, end - current);
  const ratio = remainingMs / totalMs;
  const delta = (toAmount - fromAmount) * ratio;
  return Math.round(delta);
}

/**
 * İnsan-okunabilir fatura numarası: 2026-05-00042.
 *
 * @param {Date} [now]
 * @param {number} sequenceForMonth - Bu ay içindeki sıra numarası
 */
function formatInvoiceNo(sequenceForMonth, now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const seq = String(sequenceForMonth).padStart(5, '0');
  return `${y}-${m}-${seq}`;
}

/**
 * baslangic ücretsiz mi?
 */
function isPaidPlan(plan) {
  const amount = MONTHLY_PRICES[plan];
  return amount != null && amount > 0;
}

module.exports = {
  TAX_RATE,
  YEARLY_DISCOUNT,
  MONTHLY_PRICES,
  VALID_PLANS,
  VALID_CYCLES,
  getBaseAmount,
  calculateTotal,
  prorateChange,
  formatInvoiceNo,
  isPaidPlan,
};
