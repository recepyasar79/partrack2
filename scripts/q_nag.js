const db=require('/app/backend/src/db');
(async()=>{
  const rows=await db('ocr_metrics as m').leftJoin('gunluk_kontroller as k','m.gunluk_kontrol_id','k.id')
    .whereRaw("m.created_at >= now() - interval '240 minutes'")
    .where(q=>q.where('m.plate_returned','like','%MSG%').orWhere('k.plaka','34NAG438').orWhere('m.corrected_to','34NAG438').orWhere('k.plaka','like','%MSG%'))
    .orderBy('m.created_at','asc')
    .select(db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.id','m.ocr_engine','m.raw_text','m.plate_returned','m.confidence','m.strategy',
      'm.ocr_ok','m.was_corrected_by_user','m.corrected_to','k.id as kid','k.plaka as final');
  for(const r of rows) console.log(JSON.stringify(r));
  console.log('toplam',rows.length);
  await db.destroy();
})().catch(e=>{console.error(e.message);process.exit(1)});
