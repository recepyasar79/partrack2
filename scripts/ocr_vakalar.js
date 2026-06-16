const db = require('/app/backend/src/db');
const ilgili = ['80KAD05', '61MTJ702', '57PQ84', '34CHF751', '34CHF716', '34DDU207',
  '34TV2580', '34NAG438', '34MSG617', '34KYY733', '34DEA665', '34CZN449'];

(async () => {
  // 1) Son 3 saatteki timeout'lar (zamanlama)
  const tos = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw("m.created_at >= now() - interval '180 minutes'")
    .whereRaw("lower(m.error) like '%timeout%'")
    .orderBy('m.created_at', 'asc')
    .select(db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'k.plaka as final', 'm.error');
  console.log(`=== SON 3 SAAT TIMEOUT (${tos.length}) ===`);
  for (const r of tos) console.log(`${r.t} | final=${r.final || '-'} | ${r.ocr_engine}`);

  // 2) Ilgili plaka vakalari (reklam suphesi) — ham metin
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw("m.created_at >= now() - interval '240 minutes'")
    .where((q) => q.whereIn('m.plate_returned', ilgili).orWhereIn('k.plaka', ilgili).orWhereIn('m.corrected_to', ilgili))
    .orderBy('m.created_at', 'asc')
    .select(db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence', 'm.strategy', 'm.elapsed_ms',
      'm.was_corrected_by_user', 'm.corrected_to', 'k.plaka as final');
  console.log(`\n=== ILGILI VAKALAR (${rows.length}) ===`);
  for (const r of rows) {
    const c = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    console.log(`${r.t} | ${r.ocr_engine} | ham="${r.raw_text || ''}" | donen=${r.plate_returned || '-'} | final=${r.final || '-'} | ${c} | ${r.elapsed_ms || '-'}ms | ${r.strategy || '-'}${r.was_corrected_by_user ? ' DUZ->' + r.corrected_to : ''}`);
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
