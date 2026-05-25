const express = require('express');
const { authRequired, requireSuperadmin } = require('../middleware/auth');
const { getSummary } = require('../services/ocrMetrics');

const router = express.Router();

// OCR doğruluk + p95 latency'si platform katmanı metriğidir; OCR motoru
// karşılaştırması ve faturalama için kullanılır. Sadece superadmin görür.
// Site verisine erişim yok — yalnız ocr_metrics agregesi.
// ?siteId=N verilirse tek site, verilmezse tüm sitelerin toplamı döner.
router.get('/summary', authRequired, requireSuperadmin, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const siteIdParam = req.query.siteId ? parseInt(req.query.siteId, 10) : null;
    const summary = await getSummary(days, siteIdParam);
    res.json(summary);
  } catch (e) { next(e); }
});

module.exports = router;
