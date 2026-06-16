// Son 3 saatteki OCR okumalarını analiz et (prod ocr_metrics).
// flyctl ssh ile parktrack-backend üzerinde çalışır (NODE_ENV=production → Neon).
const db = require('/app/backend/src/db');

(async () => {
  const since = "now() - interval '3 hours'";
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw(`m.created_at >= ${since}`)
    .orderBy('m.created_at', 'asc')
    .select(
      'm.id',
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul', 'HH24:MI:SS') as t"),
      'm.ocr_engine',
      'm.raw_text',
      'm.plate_returned',
      'm.confidence',
      'm.strategy',
      'm.elapsed_ms',
      'm.ocr_ok',
      'm.error',
      'm.was_corrected_by_user',
      'm.corrected_to',
      'k.plaka as final_plaka',
      'k.foto_url'
    );

  const total = rows.length;
  const withPhoto = rows.filter((r) => r.foto_url);     // foto var = kamera/galeri upload
  const noPhoto = rows.filter((r) => !r.foto_url && r.gunluk_kontrol_id !== null);
  const okPlate = rows.filter((r) => r.ocr_ok && r.plate_returned);
  const emptyPlate = rows.filter((r) => !r.plate_returned);
  const corrected = rows.filter((r) => r.was_corrected_by_user);
  const failed = rows.filter((r) => !r.ocr_ok);

  const byEngine = {};
  for (const r of rows) {
    const e = r.ocr_engine || '?';
    byEngine[e] = byEngine[e] || { n: 0, corrected: 0, empty: 0 };
    byEngine[e].n++;
    if (r.was_corrected_by_user) byEngine[e].corrected++;
    if (!r.plate_returned) byEngine[e].empty++;
  }

  console.log('=== SON 3 SAAT OCR ÖZET ===');
  console.log(JSON.stringify({
    total,
    okPlate: okPlate.length,
    emptyPlate: emptyPlate.length,
    corrected: corrected.length,
    failed: failed.length,
    byEngine,
  }, null, 2));

  console.log('\n=== TÜM OKUMALAR (zaman sırası) ===');
  for (const r of rows) {
    const conf = r.confidence != null ? (Math.round(r.confidence * 100) + '%') : '-';
    const flags = [
      r.was_corrected_by_user ? `DÜZELTİLDİ→${r.corrected_to}` : '',
      !r.ocr_ok ? 'OCR_FAIL' : '',
      !r.plate_returned ? 'BOŞ' : '',
      r.foto_url ? '' : 'FOTOSUZ(manuel)',
    ].filter(Boolean).join(' ');
    console.log(
      `${r.t} | eng=${r.ocr_engine} | ham="${r.raw_text || ''}" | dönen=${r.plate_returned || '-'} | final=${r.final_plaka || '-'} | conf=${conf} | ${r.elapsed_ms || '-'}ms ${flags ? '| ' + flags : ''}${r.error ? ' | ERR: ' + r.error : ''}`
    );
  }

  await db.destroy();
})().catch((e) => { console.error('HATA:', e); process.exit(1); });
