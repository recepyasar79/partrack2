const db = require('/app/backend/src/db');
const { todayTR, normalizeMisafirZaman } = require('/app/backend/src/utils/timezone');
const { normalizePlaka } = require('/app/backend/src/utils/validators');

(async () => {
  const tarih = todayTR();
  const nowtr = await db.raw("select to_char(now() at time zone 'Europe/Istanbul','YYYY-MM-DD HH24:MI') as t");
  console.log('su an TR:', nowtr.rows[0].t, '| todayTR:', tarih);

  const dates = await db('gunluk_kontroller')
    .select(db.raw('kontrol_tarihi::text as d')).count('* as n')
    .groupBy('kontrol_tarihi').orderBy('kontrol_tarihi', 'desc').limit(5);
  console.log('son gunluk_kontroller tarihleri:', JSON.stringify(dates));

  const gc = await db('gece_cetelesi').where({ tarih })
    .select('site_id', 'daire_id', 'arac_sayisi', db.raw("to_char(guncelleme_zamani at time zone 'Europe/Istanbul','HH24:MI:SS') as gz"));
  console.log('gece_cetelesi BUGUN satir:', gc.length, JSON.stringify(gc.slice(0, 15)));

  const todayRows = await db('gunluk_kontroller').where({ kontrol_tarihi: tarih }).select('site_id');
  const sites = [...new Set(todayRows.map((r) => r.site_id))];
  console.log('bugun yukleme yapan site_id(ler):', sites.join(',') || '(yok)');

  for (const siteId of (sites.length ? sites : [1])) {
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
    const counts = new Map(); let kayitsiz = 0;
    for (const p of gorulen) {
      const d = m2d.has(p) ? m2d.get(p) : p2d.get(p);
      if (d == null) { kayitsiz++; continue; }
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    console.log(`site ${siteId}: gorulen_plaka=${gorulen.size}, eslesen_daire=${counts.size}, kayitsiz=${kayitsiz}, araclar_aktif=${araclar.length}, misafir_aktif=${mis.length}`);
    console.log('  tohum ornek (daire_id:sayi):', JSON.stringify([...counts.entries()].slice(0, 12)));
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
