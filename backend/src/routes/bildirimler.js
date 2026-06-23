const express = require('express');
const db = require('../db');
const { authRequired, requireScopedSite, requireSiteAdmin } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { writeAudit } = require('../middleware/audit');
const { sendTemplate, buildMessage, sendSummaryTemplate } = require('../services/whatsapp');
const { isValidTelefon } = require('../utils/validators');
const { ceteleGunuTR } = require('../utils/timezone');

const router = express.Router();
router.use(authRequired, requireScopedSite, requireActiveSubscription);
const MAX_DENEME = 3;
const MAX_BILDIRIM_TEL = 5;

// Ham girdiyi 05XXXXXXXXX yerel formatına normalize et (+90 / 90 / 5XXXXXXXXX
// kabul eder). Geçersizse null döner.
function normalizeBildirimTel(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (n.startsWith('90')) n = '0' + n.slice(2);
  if (n.length === 10 && n.startsWith('5')) n = '0' + n;
  return isValidTelefon(n) ? n : null;
}

// jsonb kolonu pg'de dizi olarak gelir; string gelirse parse et.
function parseTelListesi(val) {
  if (Array.isArray(val)) return val;
  try { const a = JSON.parse(val || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

// siteId opsiyonel — Bu fonksiyon hem route'lardan (siteId zorunlu) hem de
// arka plan retry cron'undan (tüm sitelere çalışabilir, siteId=null) çağrılır.
async function gonderBirIhlal(ihlalId, userId, ip, siteId = null) {
  let qb = db('ihlaller')
    .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
    .where('ihlaller.id', ihlalId);
  if (siteId != null) qb = qb.andWhere('ihlaller.site_id', siteId);
  const ihlal = await qb
    .select(
      'ihlaller.id',
      'ihlaller.daire_id',
      'ihlaller.daire_no_snapshot',
      'ihlaller.plaka_listesi',
      'ihlaller.ihlal_tipi',
      'ihlaller.site_id',
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
        // ihlal'in site_id'si — ihlal row'unu zaten getirdik, oradan al
        site_id: ihlal.site_id ?? siteId,
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
    site_id: ihlal.site_id ?? siteId,
    eylem: result.ok ? 'bildirim_gonder' : 'bildirim_basarisiz',
    tablo_adi: 'bildirimler',
    kayit_id: bildirim.id,
    yeni_deger: { ihlal_id: ihlal.id, daire_no: daireNo, durum: bildirim.gonderim_durumu },
    ip_adres: ip,
  });

  return { ok: result.ok, bildirim, mock: !!result.mock };
}

router.post('/gonder', async (req, res, next) => {
  try {
    const { ihlal_id } = req.body || {};
    if (!ihlal_id) return res.status(400).json({ error: 'ihlal_id zorunlu.' });
    const r = await gonderBirIhlal(ihlal_id, req.user.id, req.ip, req.scopedSiteId);
    if (!r.ok && r.status) return res.status(r.status).json({ error: r.error, bildirim: r.bildirim });
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/toplu-gonder', async (req, res, next) => {
  try {
    const { ihlal_idleri } = req.body || {};
    if (!Array.isArray(ihlal_idleri) || !ihlal_idleri.length) {
      return res.status(400).json({ error: 'ihlal_idleri listesi zorunlu.' });
    }
    const sonuclar = [];
    for (const id of ihlal_idleri) {
      const r = await gonderBirIhlal(id, req.user.id, req.ip, req.scopedSiteId);
      sonuclar.push({ ihlal_id: id, ...r });
    }
    const basari = sonuclar.filter((s) => s.ok).length;
    res.json({ basari, hata: sonuclar.length - basari, sonuclar });
  } catch (e) { next(e); }
});

// --- Site'nin WhatsApp bildirim numaraları (en fazla 5, müşteri-bazlı) ---

// Mevcut numaraları döner (scoped kullanıcılar görebilir).
router.get('/site-telefonlari', async (req, res, next) => {
  try {
    const site = await db('sites').where({ id: req.scopedSiteId }).first();
    res.json({ telefonlar: parseTelListesi(site?.bildirim_telefonlari) });
  } catch (e) { next(e); }
});

// Numaraları günceller (yalnız site yöneticisi). En fazla 5, 05XXXXXXXXX formatı.
router.put('/site-telefonlari', requireSiteAdmin, async (req, res, next) => {
  try {
    const { telefonlar } = req.body || {};
    if (!Array.isArray(telefonlar)) {
      return res.status(400).json({ error: 'telefonlar bir dizi olmalı.' });
    }
    const temiz = [];
    for (const t of telefonlar) {
      if (String(t || '').trim() === '') continue; // boş satırları atla
      const n = normalizeBildirimTel(t);
      if (!n) {
        return res.status(400).json({ error: `Geçersiz telefon: ${t} (05XXXXXXXXX bekleniyor).` });
      }
      if (!temiz.includes(n)) temiz.push(n);
    }
    if (temiz.length > MAX_BILDIRIM_TEL) {
      return res.status(400).json({ error: `En fazla ${MAX_BILDIRIM_TEL} numara tanımlayabilirsiniz.` });
    }
    const eski = await db('sites').where({ id: req.scopedSiteId }).first();
    await db('sites').where({ id: req.scopedSiteId }).update({ bildirim_telefonlari: JSON.stringify(temiz) });
    await writeAudit({
      user_id: req.user.id,
      site_id: req.scopedSiteId,
      eylem: 'bildirim_telefon_guncelle',
      tablo_adi: 'sites',
      kayit_id: req.scopedSiteId,
      eski_deger: { bildirim_telefonlari: parseTelListesi(eski?.bildirim_telefonlari) },
      yeni_deger: { bildirim_telefonlari: temiz },
      ip_adres: req.ip,
    });
    res.json({ telefonlar: temiz });
  } catch (e) { next(e); }
});

// Günün çoklu-araç ihlallerini tek özet mesajda site'nin yetkili numaralarına
// gönderir. Daire sahibine giden bireysel bildirimden ayrıdır (bu yönetim
// özeti). Bugün ihlal yoksa mesaj atmaz.
router.post('/gunluk-ozet-gonder', async (req, res, next) => {
  try {
    const siteId = req.scopedSiteId;
    const tarih = req.body?.tarih || ceteleGunuTR();

    const site = await db('sites').where({ id: siteId }).first();
    const telefonlar = parseTelListesi(site?.bildirim_telefonlari);
    if (!telefonlar.length) {
      return res.status(400).json({ error: 'Önce bildirim telefon numaralarını tanımlayın.' });
    }

    const ihlaller = await db('ihlaller as i')
      .leftJoin('daireler as d', 'i.daire_id', 'd.id')
      .where({ 'i.site_id': siteId, 'i.kontrol_tarihi': tarih, 'i.ihlal_tipi': 'coklu_arac' })
      .orderBy('d.blok')
      .orderBy('d.sira_no')
      .select('i.daire_no_snapshot', 'i.plaka_listesi', 'd.daire_no');

    if (!ihlaller.length) {
      return res.json({ ihlal_sayisi: 0, gonderildi: false, mesaj: 'Bugün için çoklu araç ihlali yok.' });
    }

    // Özet tek satır (WhatsApp parametresi yeni satır kabul etmez). Örn:
    // "D25 (34KMM494, 34PEG260); B9 (34PFD753, 34FDM998)". Aşırı uzunsa kırp.
    const parcalar = ihlaller.map((i) => {
      const dn = i.daire_no || i.daire_no_snapshot || '?';
      const plakalar = Array.isArray(i.plaka_listesi)
        ? i.plaka_listesi
        : JSON.parse(i.plaka_listesi || '[]');
      return `${dn} (${plakalar.join(', ')})`;
    });
    let ozet = parcalar.join('; ');
    if (ozet.length > 900) ozet = ozet.slice(0, 897) + '...';

    const tarihStr = String(tarih).slice(0, 10).split('-').reverse().join('.'); // DD.MM.YYYY
    const sonuclar = [];
    for (const tel of telefonlar) {
      const r = await sendSummaryTemplate({ telefon: tel, tarih: tarihStr, sayi: ihlaller.length, ozet });
      sonuclar.push({ tel, ok: r.ok, mock: !!r.mock, hata: r.hata });
    }
    const basari = sonuclar.filter((s) => s.ok).length;

    await writeAudit({
      user_id: req.user.id,
      site_id: siteId,
      eylem: 'gunluk_ozet_gonder',
      tablo_adi: 'sites',
      kayit_id: siteId,
      yeni_deger: { ihlal_sayisi: ihlaller.length, alici: telefonlar.length, basari },
      ip_adres: req.ip,
    });

    res.json({
      ihlal_sayisi: ihlaller.length,
      alici_sayisi: telefonlar.length,
      basari,
      hata: telefonlar.length - basari,
      mock: sonuclar.some((s) => s.mock),
      gonderildi: basari > 0,
    });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const { durum, baslangic, bitis } = req.query;
    let qb = db('bildirimler')
      .where({ site_id: req.scopedSiteId })
      .orderBy('olusturma_zamani', 'desc');
    if (durum) qb = qb.where({ gonderim_durumu: durum });
    if (baslangic) qb = qb.where('olusturma_zamani', '>=', baslangic);
    if (bitis) qb = qb.where('olusturma_zamani', '<=', bitis);
    const bildirimler = await qb.limit(500);
    res.json({ bildirimler });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.gonderBirIhlal = gonderBirIhlal;
