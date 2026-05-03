const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, requireRole('yonetici'), async (req, res) => {
  const { user_id, tablo, baslangic, bitis, limit = 200 } = req.query;
  let qb = db('audit_log')
    .leftJoin('users', 'audit_log.user_id', 'users.id')
    .select(
      'audit_log.*',
      'users.kullanici_adi'
    );
  if (user_id) qb = qb.where('audit_log.user_id', user_id);
  if (tablo) qb = qb.where('audit_log.tablo_adi', tablo);
  if (baslangic) qb = qb.where('audit_log.zaman', '>=', baslangic);
  if (bitis) qb = qb.where('audit_log.zaman', '<=', bitis);
  const list = await qb.orderBy('audit_log.zaman', 'desc').limit(Math.min(parseInt(limit, 10) || 200, 1000));
  res.json({ kayitlar: list });
});

module.exports = router;
