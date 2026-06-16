// Son 45 dakikadaki OCR okumaları — timeout zamanlamasi + reklam-yazisi vakalari.
const db = require('/app/backend/src/db');

(async () => {
  const nowtr = await db.raw("select to_char(now() at time zone 'Europe/Istanbul','HH24:MI:SS') as t");
  console.log('su an TR:', nowtr.rows[0].t);

  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw("m.created_at >= now() - interval '45 minutes'")
    .orderBy('m.created_at', 'asc')
    .select(
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence', 'm.strategy',
      'm.elapsed_ms', 'm.ocr_ok', 'm.error', 'm.was_corrected_by_user', 'm.corrected_to', 'k.plaka as final'
    );

  let timeout = 0;
  for (const r of rows) if ((r.error || '').toLowerCase().includes('timeout')) timeout++;
  console.log(`toplam=${rows.length}, timeout=${timeout}`);

  // Reklam suphesi: final ile donen cok farkli VE ham'da bayi anahtar kelimesi
  const bayiRe = /OTOMOT|MOTOR|SERVIS|RENAULT|NISSAN|OPEL|OTO |WWW|COM|PLAZA|AUTO|TR /i;
  console.log('\n=== TUM OKUMALAR ===');
  for (const r of rows) {
    const c = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    const fl = [
      !r.ocr_ok ? 'FAIL' : '',
      r.was_corrected_by_user ? 'DUZ->' + r.corrected_to : '',
      (r.final && r.plate_returned && r.final !== r.plate_returned) ? 'matcher' : '',
      (r.raw_text && bayiRe.test(r.raw_text)) ? 'BAYI?' : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.t} | ${r.ocr_engine} | ham="${r.raw_text || ''}" | donen=${r.plate_returned || '-'} | final=${r.final || '-'} | ${c} | ${r.elapsed_ms || '-'}ms | ${r.strategy || '-'}${fl ? ' | ' + fl : ''}${r.error ? ' | ERR:' + r.error : ''}`);
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
