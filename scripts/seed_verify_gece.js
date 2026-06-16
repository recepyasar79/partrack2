// Bugünün Gece Çetelesi'ni gerçek prod tespitiyle tohumlar (yeni GET mantığının
// aynısı: tüm daireleri akşam tespit değeriyle ÜZERINE yazar) ve özetler.
const db = require('/app/backend/src/db');
const { todayTR, normalizeMisafirZaman } = require('/app/backend/src/utils/timezone');
const { normalizePlaka } = require('/app/backend/src/utils/validators');

(async () => {
  try {
    const r = await fetch('http://localhost:3000/health');
    console.log('HEALTH:', r.status, await r.text());
  } catch (e) { console.log('HEALTH ERR:', e.message); }

  const tarih = todayTR();
  const siteId = 1;

  const kontroller = await db('gunluk_kontroller')
    .where({ kontrol_tarihi: tarih, site_id: siteId }).whereNotNull('plaka').where('plaka', '!=', '');
  const gorulen = new Set();
  for (const k of kontroller) { const p = normalizePlaka(k.plaka); if (p) gorulen.add(p); }

  const araclar = await db('araclar').where({ site_id: siteId, aktif: true }).select('plaka', 'daire_id');
  const p2d = new Map(); for (const a of araclar) p2d.set(normalizePlaka(a.plaka), a.daire_id);
  const ref = normalizeMisafirZaman(`${tarih}T20:00`, false);
  const mis = await db('misafir_araclar').where('site_id', siteId)
    .andWhere('baslangic_tarihi', '<=', ref).andWhere('bitis_tarihi', '>=', ref).select('plaka', 'daire_id');
  const m2d = new Map(); for (const m of mis) m2d.set(normalizePlaka(m.plaka), m.daire_id);

  const counts = new Map();
  for (const p of gorulen) { const d = m2d.has(p) ? m2d.get(p) : p2d.get(p); if (d != null) counts.set(d, (counts.get(d) || 0) + 1); }

  const daireler = await db('daireler').where({ site_id: siteId, aktif: true }).select('id');
  const rows = daireler.map((d) => ({
    site_id: siteId, daire_id: d.id, tarih, arac_sayisi: counts.get(d.id) || 0, guncelleme_zamani: db.fn.now(),
  }));
  await db('gece_cetelesi').insert(rows).onConflict(['site_id', 'daire_id', 'tarih']).merge(['arac_sayisi', 'guncelleme_zamani']);

  const s = await db('gece_cetelesi').where({ site_id: siteId, tarih }).select(
    db.raw('count(*)::int as toplam'),
    db.raw('count(*) filter (where arac_sayisi>0)::int as dolu'),
    db.raw('count(*) filter (where arac_sayisi=1)::int as bir_sari'),
    db.raw('count(*) filter (where arac_sayisi=2)::int as iki_kirmizi'),
    db.raw('count(*) filter (where arac_sayisi>=3)::int as ucplus_koyu')
  ).first();
  console.log('TOHUM+OZET:', JSON.stringify(s));
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
