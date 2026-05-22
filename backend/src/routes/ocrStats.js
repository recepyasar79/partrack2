const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const { getSummary } = require('../services/ocrMetrics');

const router = express.Router();

// Yönetici doğruluk + p95 latency'sini görür. Kademe 1 → 2 → 3
// geçişlerinin etkisini buradan ölçeceğiz.
router.get('/summary', authRequired, requireRole('yonetici'), async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const summary = await getSummary(days);
    res.json(summary);
  } catch (e) { next(e); }
});

module.exports = router;
