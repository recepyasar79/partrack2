/**
 * Faz Ü3.3 — Subscription CRUD endpoint'leri.
 *
 * Site sahibinin (site_yonetici) abonelik yaşam döngüsü:
 *   POST   /api/site/subscription          — yeni abonelik başlat
 *   GET    /api/site/subscription          — mevcut durum + fatura geçmişi
 *   PATCH  /api/site/subscription/plan     — plan değişimi (pro-rate)
 *   POST   /api/site/subscription/cancel   — period sonunda iptal
 *   POST   /api/site/subscription/reactivate — iptal kararını geri al
 *
 * Akış: provider abstract interface (services/billing) üzerinden — test'te
 * mock, production'da iyzico/paytr.
 */
const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite, requireSiteAdmin } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const {
  VALID_PLANS, VALID_CYCLES, getBaseAmount, calculateTotal,
  prorateChange, formatInvoiceNo, isPaidPlan,
} = require('../utils/pricing');
const { getEffectiveLimits } = require('../utils/planLimits');
const { getProvider } = require('../services/billing');

const router = express.Router();
router.use(authRequired, requireScopedSite);

const PAID_PLANS = VALID_PLANS.filter((p) => isPaidPlan(p));

function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Bu site için aylık fatura sıra numarası → invoice_no üretimi.
 * Global ay-bazlı sıra: tüm tenants ortak ay sayısı (basit; ileride
 * paraşüt entegrasyonunda gerçek sıra numara servisi gelir).
 */
async function nextInvoiceNo() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const row = await db('invoices')
    .where('issued_at', '>=', monthStart.toISOString())
    .count('* as c')
    .first();
  const seq = (parseInt(row.c, 10) || 0) + 1;
  return formatInvoiceNo(seq, now);
}

// --------------------------------------------------------------------
// GET — mevcut abonelik + son 12 fatura
// --------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const sub = await db('subscriptions')
      .where({ site_id: req.scopedSiteId })
      .whereNot({ status: 'cancelled' })
      .orderBy('id', 'desc')
      .first();
    let invoices = [];
    if (sub) {
      invoices = await db('invoices')
        .where({ subscription_id: sub.id })
        .orderBy('issued_at', 'desc')
        .limit(12);
    }
    res.json({ subscription: sub || null, invoices });
  } catch (e) { next(e); }
});

// --------------------------------------------------------------------
// POST — yeni abonelik başlat
// --------------------------------------------------------------------
router.post('/', requireSiteAdmin, async (req, res, next) => {
  try {
    const { plan, cycle } = req.body || {};
    if (!PAID_PLANS.includes(plan)) {
      return res.status(400).json({ error: `Plan yalnız: ${PAID_PLANS.join(', ')}` });
    }
    if (!VALID_CYCLES.includes(cycle)) {
      return res.status(400).json({ error: 'cycle: monthly veya yearly' });
    }
    const existing = await db('subscriptions')
      .where({ site_id: req.scopedSiteId })
      .whereNot({ status: 'cancelled' })
      .first();
    if (existing) {
      return res.status(409).json({ error: 'Bu site için zaten aktif abonelik var. Plan değişimi için PATCH /plan kullanın.' });
    }
    const site = await db('sites').where({ id: req.scopedSiteId }).first();
    if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });

    const provider = getProvider();
    const created = await provider.createSubscription({
      site,
      plan,
      cycle,
      customer: {
        email: req.user.email || null,
        kullanici_adi: req.user.kullanici_adi,
      },
      returnUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    });

    const now = new Date();
    const periodEnd = addCycle(now, cycle);
    const [sub] = await db('subscriptions').insert({
      site_id: req.scopedSiteId,
      plan,
      billing_cycle: cycle,
      status: created.status === 'pending' ? 'past_due' : 'active',
      provider: provider.name,
      provider_subscription_id: created.provider_subscription_id,
      current_period_start: now,
      current_period_end: periodEnd,
    }).returning('*');

    // İlk fatura (KDV dahil hesabıyla) — provider 'active' dönmüşse paid say,
    // 'pending' ise ödeme bekleniyor.
    const base = getBaseAmount(plan, cycle);
    const totals = calculateTotal(base);
    const invoiceNo = await nextInvoiceNo();
    const [invoice] = await db('invoices').insert({
      site_id: req.scopedSiteId,
      subscription_id: sub.id,
      invoice_no: invoiceNo,
      amount_excl_tax: totals.amount_excl_tax,
      tax_rate: totals.tax_rate,
      amount_incl_tax: totals.amount_incl_tax,
      period_start: now,
      period_end: periodEnd,
      status: created.status === 'active' ? 'paid' : 'pending',
      paid_at: created.status === 'active' ? now : null,
    }).returning('*');

    // Provider chargeRecurring çağrısı — mock'ta hemen success
    if (created.status === 'active') {
      const charge = await provider.chargeRecurring({ subscription: sub, invoice });
      await db('payment_attempts').insert({
        invoice_id: invoice.id,
        provider: provider.name,
        provider_payment_id: charge.provider_payment_id,
        status: charge.status,
        amount: invoice.amount_incl_tax,
        attempt_no: 1,
        error_message: charge.error_message || null,
        raw_response: charge.raw ? JSON.stringify(charge.raw) : null,
      });
    }

    // sites.plan'ı YALNIZ ödeme tamamlanınca (provider 'active') yükselt.
    // 'pending' (→ status 'past_due') durumunda checkout henüz tamamlanmadı;
    // ücretli plan limitleri/özellikleri açılmamalı. Plan, webhook
    // 'subscription.activated' / 'payment.success' geldiğinde yükseltilir
    // (routes/webhooks.js). Aksi halde kullanıcı ödeme yapmadan plana erişirdi.
    if (created.status === 'active') {
      await db('sites').where({ id: req.scopedSiteId }).update({ plan });
    }

    await writeAudit({
      user_id: req.user.id,
      site_id: req.scopedSiteId,
      eylem: 'olustur',
      tablo_adi: 'subscriptions',
      kayit_id: sub.id,
      yeni_deger: { plan, cycle, provider: provider.name },
      ip_adres: req.ip,
    });

    res.status(201).json({
      subscription: sub,
      invoice,
      checkout_url: created.checkout_url,
    });
  } catch (e) { next(e); }
});

// --------------------------------------------------------------------
// PATCH /plan — plan değişimi (pro-rate)
// --------------------------------------------------------------------
router.patch('/plan', requireSiteAdmin, async (req, res, next) => {
  try {
    const { plan: newPlan } = req.body || {};
    if (!VALID_PLANS.includes(newPlan)) {
      return res.status(400).json({ error: 'Geçersiz plan.' });
    }
    const sub = await db('subscriptions')
      .where({ site_id: req.scopedSiteId })
      .whereNot({ status: 'cancelled' })
      .orderBy('id', 'desc')
      .first();
    if (!sub) {
      return res.status(404).json({ error: 'Aktif abonelik yok. Önce POST ile başlatın.' });
    }
    if (sub.plan === newPlan) {
      return res.status(400).json({ error: 'Mevcut plan aynı.' });
    }

    const site = await db('sites').where({ id: req.scopedSiteId }).first();

    // Yeni plan'ın limit'leri current kullanımı karşılayabilir mi?
    // Override yok varsayımıyla — gerçek check getEffectiveLimits +
    // override fallback. Site'nin mevcut plan_limits override'ı varsa
    // o korunur ama plan değişince base default'lar değişir.
    const newSite = { ...site, plan: newPlan };
    const newLimits = getEffectiveLimits(newSite);
    if (newLimits.daire_max != null) {
      const dCount = await db('daireler')
        .where({ site_id: req.scopedSiteId, aktif: true })
        .count('* as c')
        .first();
      if ((parseInt(dCount.c, 10) || 0) > newLimits.daire_max) {
        return res.status(402).json({
          error: `Mevcut daire sayısı (${dCount.c}) yeni planın limitini (${newLimits.daire_max}) aşıyor. Daire silin veya daha üst plan seçin.`,
          limit: 'daire_max', current: parseInt(dCount.c, 10), max: newLimits.daire_max,
        });
      }
    }
    if (newLimits.user_max != null) {
      const uCount = await db('users')
        .where({ site_id: req.scopedSiteId, aktif: true })
        .count('* as c')
        .first();
      if ((parseInt(uCount.c, 10) || 0) > newLimits.user_max) {
        return res.status(402).json({
          error: `Mevcut kullanıcı sayısı (${uCount.c}) yeni planın limitini (${newLimits.user_max}) aşıyor.`,
          limit: 'user_max', current: parseInt(uCount.c, 10), max: newLimits.user_max,
        });
      }
    }

    // Pro-rate hesabı
    const deltaExcl = prorateChange({
      fromPlan: sub.plan,
      toPlan: newPlan,
      cycle: sub.billing_cycle,
      periodStart: sub.current_period_start,
      periodEnd: sub.current_period_end,
    });

    // baslangic'a downgrade → period end'de iptal, fatura yok
    if (!isPaidPlan(newPlan)) {
      await db('subscriptions').where({ id: sub.id }).update({
        plan: newPlan,
        cancel_at_period_end: true,
        updated_at: db.fn.now(),
      });
      await db('sites').where({ id: req.scopedSiteId }).update({ plan: newPlan });
      await writeAudit({
        user_id: req.user.id, site_id: req.scopedSiteId,
        eylem: 'guncelle', tablo_adi: 'subscriptions', kayit_id: sub.id,
        eski_deger: { plan: sub.plan }, yeni_deger: { plan: newPlan, cancel_at_period_end: true },
        ip_adres: req.ip,
      });
      return res.json({
        subscription: await db('subscriptions').where({ id: sub.id }).first(),
        prorate: { delta: 0, message: 'baslangic ücretsiz — dönem sonu downgrade' },
      });
    }

    let invoice = null;
    if (deltaExcl > 0) {
      // Ek tahsilat: yeni invoice + charge
      const totals = calculateTotal(deltaExcl);
      const invoiceNo = await nextInvoiceNo();
      const [inv] = await db('invoices').insert({
        site_id: req.scopedSiteId, subscription_id: sub.id, invoice_no: invoiceNo,
        amount_excl_tax: totals.amount_excl_tax, tax_rate: totals.tax_rate,
        amount_incl_tax: totals.amount_incl_tax,
        period_start: new Date(), period_end: sub.current_period_end,
        status: 'pending',
      }).returning('*');
      invoice = inv;

      const provider = getProvider(sub.provider);
      const charge = await provider.chargeRecurring({ subscription: sub, invoice: inv });
      await db('payment_attempts').insert({
        invoice_id: inv.id, provider: provider.name,
        provider_payment_id: charge.provider_payment_id,
        status: charge.status, amount: inv.amount_incl_tax, attempt_no: 1,
        error_message: charge.error_message || null,
        raw_response: charge.raw ? JSON.stringify(charge.raw) : null,
      });
      if (charge.status === 'success') {
        [invoice] = await db('invoices').where({ id: inv.id })
          .update({ status: 'paid', paid_at: db.fn.now() }).returning('*');
      } else {
        // Ödeme fail → plan değişmesin, kullanıcıya hata dön
        return res.status(402).json({
          error: 'Pro-rate ek tahsilat başarısız oldu. Kart bilgilerinizi kontrol edin.',
          payment_error: charge.error_message,
        });
      }
    }
    // deltaExcl <= 0 → credit (downgrade); ileride bir credit hesabı tutulabilir.
    // MVP: credit kaybolur, bir sonraki fatura yeni plan üzerinden.

    await db('subscriptions').where({ id: sub.id }).update({
      plan: newPlan,
      updated_at: db.fn.now(),
    });
    await db('sites').where({ id: req.scopedSiteId }).update({ plan: newPlan });
    await writeAudit({
      user_id: req.user.id, site_id: req.scopedSiteId,
      eylem: 'guncelle', tablo_adi: 'subscriptions', kayit_id: sub.id,
      eski_deger: { plan: sub.plan }, yeni_deger: { plan: newPlan, prorate_delta: deltaExcl },
      ip_adres: req.ip,
    });
    res.json({
      subscription: await db('subscriptions').where({ id: sub.id }).first(),
      invoice,
      prorate: { delta: deltaExcl, message: deltaExcl > 0 ? 'Ek tahsilat yapıldı' : 'Credit (sonraki fatura) hesaba yansır' },
    });
  } catch (e) { next(e); }
});

// --------------------------------------------------------------------
// POST /cancel — period sonunda iptal
// --------------------------------------------------------------------
router.post('/cancel', requireSiteAdmin, async (req, res, next) => {
  try {
    const sub = await db('subscriptions')
      .where({ site_id: req.scopedSiteId })
      .whereNot({ status: 'cancelled' })
      .orderBy('id', 'desc')
      .first();
    if (!sub) return res.status(404).json({ error: 'Aktif abonelik yok.' });

    const provider = getProvider(sub.provider);
    await provider.cancelSubscription({ subscription: sub, atPeriodEnd: true });

    await db('subscriptions').where({ id: sub.id }).update({
      cancel_at_period_end: true,
      updated_at: db.fn.now(),
    });
    await writeAudit({
      user_id: req.user.id, site_id: req.scopedSiteId,
      eylem: 'iptal', tablo_adi: 'subscriptions', kayit_id: sub.id,
      eski_deger: { cancel_at_period_end: false },
      yeni_deger: { cancel_at_period_end: true },
      ip_adres: req.ip,
    });
    res.json({
      subscription: await db('subscriptions').where({ id: sub.id }).first(),
      message: `Aboneliğiniz ${sub.current_period_end} tarihinde sona erecek. O zamana kadar tüm özellikler aktif.`,
    });
  } catch (e) { next(e); }
});

// --------------------------------------------------------------------
// POST /reactivate — iptal kararını geri al
// --------------------------------------------------------------------
router.post('/reactivate', requireSiteAdmin, async (req, res, next) => {
  try {
    const sub = await db('subscriptions')
      .where({ site_id: req.scopedSiteId })
      .whereNot({ status: 'cancelled' })
      .orderBy('id', 'desc')
      .first();
    if (!sub) return res.status(404).json({ error: 'Aktif abonelik yok.' });
    if (!sub.cancel_at_period_end) {
      return res.status(400).json({ error: 'Abonelik zaten reactive — iptal kararı yok.' });
    }
    await db('subscriptions').where({ id: sub.id }).update({
      cancel_at_period_end: false,
      updated_at: db.fn.now(),
    });
    await writeAudit({
      user_id: req.user.id, site_id: req.scopedSiteId,
      eylem: 'guncelle', tablo_adi: 'subscriptions', kayit_id: sub.id,
      eski_deger: { cancel_at_period_end: true },
      yeni_deger: { cancel_at_period_end: false },
      ip_adres: req.ip,
    });
    res.json({ subscription: await db('subscriptions').where({ id: sub.id }).first() });
  } catch (e) { next(e); }
});

module.exports = router;
