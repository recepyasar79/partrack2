/**
 * GET /api/site-usage — Site'nin mevcut kullanım/limit özetini döner.
 *
 * Faz Ü2.4. Home sayfasındaki "X / Y daire" göstergeleri için. Site-bağlı
 * user'lar kendi site'lerini görür; superadmin platform-wide aggregate
 * yapmadığı için 403 döner (öyle bir endpoint Sites detayında zaten var).
 */
const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite } = require('../middleware/auth');
const { getEffectiveLimits } = require('../utils/planLimits');

const router = express.Router();

router.get('/', authRequired, requireScopedSite, async (req, res, next) => {
  try {
    const site = await db('sites').where({ id: req.scopedSiteId }).first();
    if (!site) return res.status(404).json({ error: 'Site bulunamadı.' });

    const [daireRow, userRow, aracRow] = await Promise.all([
      db('daireler').where({ site_id: req.scopedSiteId, aktif: true }).count('* as c').first(),
      db('users').where({ site_id: req.scopedSiteId, aktif: true }).count('* as c').first(),
      db('araclar').where({ site_id: req.scopedSiteId, aktif: true }).count('* as c').first(),
    ]);

    const limits = getEffectiveLimits(site);
    res.json({
      daire: {
        current: parseInt(daireRow.c, 10) || 0,
        max: limits.daire_max,
      },
      arac: {
        current: parseInt(aracRow.c, 10) || 0,
        max: null,
      },
      user: {
        current: parseInt(userRow.c, 10) || 0,
        max: limits.user_max,
      },
      plan: site.plan,
    });
  } catch (e) { next(e); }
});

module.exports = router;
