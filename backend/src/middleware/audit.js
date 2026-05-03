const db = require('../db');

async function writeAudit({ user_id, eylem, tablo_adi, kayit_id, eski_deger, yeni_deger, ip_adres }) {
  try {
    await db('audit_log').insert({
      user_id: user_id || null,
      eylem,
      tablo_adi,
      kayit_id: kayit_id || null,
      eski_deger: eski_deger ? JSON.stringify(eski_deger) : null,
      yeni_deger: yeni_deger ? JSON.stringify(yeni_deger) : null,
      ip_adres: ip_adres || null,
    });
  } catch (err) {
    console.error('[audit] yazılamadı:', err.message);
  }
}

function audit(eylem, tablo_adi) {
  return (req, _res, next) => {
    req.audit = { eylem, tablo_adi };
    next();
  };
}

module.exports = { writeAudit, audit };
