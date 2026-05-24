const express = require('express');
const { authRequired, requireSiteAdmin, requireScopedSite } = require('../middleware/auth');
const { getSummary } = require('../services/ocrMetrics');

const router = express.Router();

// Yönetici doğruluk + p95 latency'sini görür. Kademe 1 → 2 → 3
// geçişlerinin etkisini buradan ölçeceğiz. Multi-tenant sonrası site
// scoped — superadmin ?siteId=N ile başka site'ye geçebilir.
router.get('/summary', authRequired, requireScopedSite, requireSiteAdmin, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const summary = await getSummary(days, req.scopedSiteId);
    res.json(summary);
  } catch (e) { next(e); }
});

module.exports = router;
