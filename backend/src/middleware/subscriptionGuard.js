/**
 * Faz Ü3.4 — Subscription guard middleware.
 *
 * suspended bir site'nin mutating endpoint'lerini bloke eder. Okuma serbest
 * (kullanıcı verisini görmeye devam edebilsin, "ödeme bekleniyor" gibi UX).
 *
 * Kullanım (route içinde):
 *   router.post('/', requireSiteAdmin, requireActiveSubscription, handler);
 *
 * suspended davranışı:
 *   - 402 Payment Required
 *   - body: { error, reason: 'subscription_suspended', grace_ends_at }
 *
 * baslangic plan'ı için subscription yok → mutating'e izin verir.
 *
 * Önemli: requireScopedSite önce gelmiş olmalı (req.scopedSiteId set).
 */
const db = require('../db');

async function requireActiveSubscription(req, res, next) {
  try {
    const siteId = req.scopedSiteId;
    if (siteId == null) {
      return res.status(400).json({ error: 'site_id gerekli.' });
    }
    // Var olan en yeni non-cancelled subscription
    const sub = await db('subscriptions')
      .where({ site_id: siteId })
      .whereNot({ status: 'cancelled' })
      .orderBy('id', 'desc')
      .first();
    // Subscription yoksa = baslangic ücretsiz; izin
    if (!sub) return next();
    if (sub.status === 'suspended') {
      return res.status(402).json({
        error: 'Abonelik askıya alındı. Lütfen ödeme yapın veya plan değiştirin.',
        reason: 'subscription_suspended',
        grace_ends_at: sub.grace_period_ends_at,
      });
    }
    next();
  } catch (e) { next(e); }
}

module.exports = { requireActiveSubscription };
