const db = require('/app/backend/src/db');
const targets = ['34NTM825','25NTM34','34ARC071','71ARC77','34PEL729','29PEL34'];
(async () => {
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k','m.gunluk_kontrol_id','k.id')
    .where((q)=>q.whereIn('m.plate_returned',targets).orWhereIn('k.plaka',targets).orWhereIn('m.corrected_to',targets))
    .orderBy('m.created_at','asc')
    .select(db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine','m.raw_text','m.plate_returned','m.confidence','m.strategy','m.was_corrected_by_user','m.corrected_to','k.plaka as final');
  for (const r of rows) {
    const c = r.confidence!=null?Math.round(r.confidence*100)+'%':'-';
    console.log(`${r.t} | eng=${r.ocr_engine} | ham="${r.raw_text||''}" | donen=${r.plate_returned||'-'} | final=${r.final||'-'} | conf=${c} | ${r.strategy||'-'}${r.was_corrected_by_user?' | DUZ->'+r.corrected_to:''}`);
  }
  console.log('toplam', rows.length);
  await db.destroy();
})().catch(e=>{console.error(e);process.exit(1)});
