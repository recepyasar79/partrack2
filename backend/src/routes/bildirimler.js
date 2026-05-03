const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');
const { sendTemplate, buildMessage } = require('../services/whatsapp');

const router = express.Router();
const MAX_DENEME = 3;

async function gonderBirIhlal(ihlalId, userId, ip) {
  const ihlal = await db('ihlaller')
    .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
    .where('ihlaller.id', ihlalId)
    .select(
      'ihlaller.id',
      'ihlaller.daire_id',
      'ihlaller.daire_no_snapshot',
      'ihlaller.plaka_listesi',
      'ihlaller.ihlal_tipi',
      'daireler.daire_no',
      'daireler.sahip_ad',
      'daireler.sahip_tel',
      'daireler.bildirim_opt_in'
    )
    .first();

  if (!ihlal) return { ok: false, status: 404, error: 'İhlal bulunamadı.' };
  if (ihlal.ihlal_tipi !== 'coklu_arac') {
    return { ok: false, status: 422, error: 'Bu ihlal tipi için bildirim gönderilemez.' };
  }
  if (!ihlal.daire_id) {
    return { ok: false, status: 422, error: 'İhlale bağlı daire yok.' };
  }
  if (!ihlal.bildirim_opt_in) {
    return { ok: false, status: 422, error: 'Daire WhatsApp bildirimine onay vermemiş.' };
  }

  const plakalar = Array.isArray(ihlal.plaka_listesi) ? ihlal.plaka_listesi : JSON.parse(ihlal.plaka_listesi || '[]');
  const daireNo = ihlal.daire_no || ihlal.daire_no_snapshot;
  const mesaj = buildMessage({ daire_no: daireNo, sahip_ad: ihlal.sahip_ad, plakalar });

  let bildirim = await db('bildirimler')
    .where({ ihlal_id: ihlal.id, gonderim_durumu: 'gonderildi' })
    .first();
  if (bildirim) {
    return { ok: true, zaten_gonderildi: true, bildirim };
  }

  bildirim = await db('bildirimler')
    .where({ ihlal_id: ihlal.id })
    .whereIn('gonderim_durumu', ['beklemede', 'basarisiz'])
    .first();

  if (bildirim && bildirim.deneme_sayisi >= MAX_DENEME) {
    return { ok: false, status: 429, error: 'Maksimum deneme sayısı aşıldı.', bildirim };
  }

  const result = await sendTemplate({
    telefon: ihlal.sahip_tel,
    daire_no: daireNo,
    sahip_ad: ihlal.sahip_ad,
    plakalar,
  });

  if (!bildirim) {
    [bildirim] = await db('bildirimler')
      .insert({
        ihlal_id: ihlal.id,
        daire_no: daireNo,
        telefon: ihlal.sahip_tel,
        mesaj,
        deneme_sayisi: 0,
        gonderim_durumu: 'beklemede',
      })
      .returning('*');
  }

  const yeniDeneme = (bildirim.deneme_sayisi || 0) + 1;
  if (result.ok) {
    [bildirim] = await db('bildirimler')
      .where({ id: bildirim.id })
      .update({
        gonderim_durumu: 'gonderildi',
        deneme_sayisi: yeniDeneme,
        gonderim_zamani: db.fn.now(),
        hata_mesaji: null,
      })
      .returning('*');
  } else {
    [bildirim] = await db('bildirimler')
      .where({ id: bildirim.id })
      .update({
        gonderim_durumu: result.transient && yeniDeneme < MAX_DENEME ? 'beklemede' : 'basarisiz',
        deneme_sayisi: yeniDeneme,
        hata_mesaji: result.hata || 'Bilinmeyen hata',
      })
      .returning('*');
  }

  await writeAudit({
    user_id: userId,
    eylem: result.ok ? 'bildirim_gonder' : 'bildirim_basarisiz',
    tablo_adi: 'bildirimler',
    kayit_id: bildirim.id,
    yeni_deger: { ihlal_id: ihlal.id, daire_no: daireNo, durum: bildirim.gonderim_durumu },
    ip_adres: ip,
  });

  return { ok: result.ok, bildirim, mock: !!result.mock };
}

router.post('/gonder', authRequired, async (req, res, next) => {
  try {
    const { ihlal_id } = req.body || {};
    if (!ihlal_id) return res.status(400).json({ error: 'ihlal_id zorunlu.' });
    const r = await gonderBirIhlal(ihlal_id, req.user.id, req.ip);
    if (!r.ok && r.status) return res.status(r.status).json({ error: r.error, bildirim: r.bildirim });
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/toplu-gonder', authRequired, async (req, res, next) => {
  try {
    const { ihlal_idleri } = req.body || {};
    if (!Array.isArray(ihlal_idleri) || !ihlal_idleri.length) {
      return res.status(400).json({ error: 'ihlal_idleri listesi zorunlu.' });
    }
    const sonuclar = [];
    for (const id of ihlal_idleri) {
      const r = await gonderBirIhlal(id, req.user.id, req.ip);
      sonuclar.push({ ihlal_id: id, ...r });
    }
    const basari = sonuclar.filter((s) => s.ok).length;
    res.json({ basari, hata: sonuclar.length - basari, sonuclar });
  } catch (e) { next(e); }
});

router.get('/', authRequired, async (req, res, next) => {
  try {
    const { durum, baslangic, bitis } = req.query;
    let qb = db('bildirimler').orderBy('olusturma_zamani', 'desc');
    if (durum) qb = qb.where({ gonderim_durumu: durum });
    if (baslangic) qb = qb.where('olusturma_zamani', '>=', baslangic);
    if (bitis) qb = qb.where('olusturma_zamani', '<=', bitis);
    const bildirimler = await qb.limit(500);
    res.json({ bildirimler });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.gonderBirIhlal = gonderBirIhlal;
