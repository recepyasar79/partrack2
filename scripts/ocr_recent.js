// Son ~40 dakikalık OCR okumalarını analiz et (saha testi sonrası).
const db = require('/app/backend/src/db');

(async () => {
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw("m.created_at >= now() - interval '60 minutes'")
    .orderBy('m.created_at', 'asc')
    .select(
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence', 'm.strategy',
      'm.elapsed_ms', 'm.ocr_ok', 'm.error', 'm.was_corrected_by_user', 'm.corrected_to',
      'k.plaka as final'
    );

  const finals = [...new Set(rows.map((r) => r.final).filter(Boolean))];
  const regRows = finals.length
    ? await db('araclar').where('aktif', true).whereIn('plaka', finals).pluck('plaka')
    : [];
  const reg = new Set(regRows);

  let empty = 0, corrected = 0, failed = 0, changed = 0, registered = 0;
  let big = 0, all = 0, other = 0;
  for (const r of rows) {
    if (!r.plate_returned) empty++;
    if (r.was_corrected_by_user) corrected++;
    if (!r.ocr_ok) failed++;
    if (r.final && r.plate_returned && r.final !== r.plate_returned) changed++;
    if (r.final && reg.has(r.final)) registered++;
    const s = r.strategy || '';
    if (s.includes('/big/') || s.endsWith('/big')) big++;
    else if (s.includes('/all/') || s.endsWith('/all')) all++;
    else other++;
  }

  console.log('=== SON 40 DK OZET ===');
  console.log(JSON.stringify({
    total: rows.length,
    plakaDonen: rows.length - empty,
    empty,
    matcherDegistirdi: changed,
    finalKayitli: registered,
    kullaniciDuzeltti: corrected,
    failed,
    strateji: { big, all, diger: other },
  }, null, 2));

  console.log('\n=== OKUMALAR (zaman sirasi) ===');
  for (const r of rows) {
    const c = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    const isReg = r.final ? (reg.has(r.final) ? 'KAYITLI' : 'kayitsiz') : '-';
    const flags = [
      r.was_corrected_by_user ? 'DUZ->' + r.corrected_to : '',
      !r.ocr_ok ? 'FAIL' : '',
      (r.final && r.plate_returned && r.final !== r.plate_returned) ? 'matcher' : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.t} | ${r.ocr_engine} | ham="${r.raw_text || ''}" | donen=${r.plate_returned || '-'} | final=${r.final || '-'}[${isReg}] | ${c} | ${r.strategy || '-'}${flags ? ' | ' + flags : ''}`);
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e); process.exit(1); });
