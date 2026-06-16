const db = require('/app/backend/src/db');
(async () => {
  const c40 = await db('ocr_metrics').whereRaw("created_at >= now() - interval '40 minutes'").count('* as n').first();
  const c180 = await db('ocr_metrics').whereRaw("created_at >= now() - interval '180 minutes'").count('* as n').first();
  const last = await db('ocr_metrics as m').leftJoin('gunluk_kontroller as k','m.gunluk_kontrol_id','k.id')
    .orderBy('m.created_at','desc').limit(10)
    .select(db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','MM-DD HH24:MI:SS') as t"),
      'm.ocr_engine','m.raw_text','m.plate_returned','m.confidence','m.strategy','k.plaka as final','m.was_corrected_by_user','m.corrected_to');
  const nowtr = await db.raw("select to_char(now() at time zone 'Europe/Istanbul','HH24:MI:SS') as t");
  console.log('su an (TR):', nowtr.rows[0].t, '| son 40dk:', c40.n, '| son 180dk:', c180.n);
  console.log('--- en son 10 kayit ---');
  for (const r of last) {
    const cf = r.confidence!=null?Math.round(r.confidence*100)+'%':'-';
    console.log(`${r.t} | ${r.ocr_engine} | ham="${r.raw_text||''}" | donen=${r.plate_returned||'-'} | final=${r.final||'-'} | ${cf} | ${r.strategy||'-'}${r.was_corrected_by_user?' | DUZ->'+r.corrected_to:''}`);
  }
  await db.destroy();
})().catch(e=>{console.error(e);process.exit(1)});
