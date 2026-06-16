// Belirli bir TR saat penceresindeki OCR okumalarını analiz et.
// Pencere: 2026-06-15 22:00 → 23:20 (Europe/Istanbul).
const db = require('/app/backend/src/db');

const BASLA = "timestamp '2026-06-15 22:00' at time zone 'Europe/Istanbul'";
const BITIS = "timestamp '2026-06-15 23:20' at time zone 'Europe/Istanbul'";

(async () => {
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw(`m.created_at >= ${BASLA} and m.created_at < ${BITIS}`)
    .orderBy('m.created_at', 'asc')
    .select(
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence', 'm.strategy',
      'm.elapsed_ms', 'm.ocr_ok', 'm.error', 'm.was_corrected_by_user', 'm.corrected_to',
      'k.plaka as final'
    );

  const finals = [...new Set(rows.map((r) => r.final).filter(Boolean))];
  const reg = new Set(finals.length
    ? await db('araclar').where('aktif', true).whereIn('plaka', finals).pluck('plaka') : []);

  let empty = 0, corrected = 0, failed = 0, changed = 0, registered = 0;
  let big = 0, all = 0, other = 0, timeout = 0, http502 = 0, digerHata = 0;
  const lat = [];
  for (const r of rows) {
    if (!r.plate_returned) empty++;
    if (r.was_corrected_by_user) corrected++;
    if (!r.ocr_ok) failed++;
    if (r.final && r.plate_returned && r.final !== r.plate_returned) changed++;
    if (r.final && reg.has(r.final)) registered++;
    if (typeof r.elapsed_ms === 'number') lat.push(r.elapsed_ms);
    const s = r.strategy || '';
    if (s.includes('/big/') || s.endsWith('/big')) big++;
    else if (s.includes('/all/') || s.endsWith('/all')) all++;
    else other++;
    const e = (r.error || '').toLowerCase();
    if (e.includes('timeout')) timeout++;
    else if (e.includes('502')) http502++;
    else if (e) digerHata++;
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : null);

  console.log('=== 22:00-23:20 OZET ===');
  console.log(JSON.stringify({
    total: rows.length, plakaDonen: rows.length - empty, empty,
    matcherDegistirdi: changed, finalKayitli: registered, kullaniciDuzeltti: corrected,
    failed, hatalar: { timeout, http502, diger: digerHata },
    strateji: { big, all, diger: other },
    latency_ms: { p50: pct(0.5), p95: pct(0.95), max: lat[lat.length - 1] || null },
  }, null, 2));

  console.log('\n=== OKUMALAR ===');
  for (const r of rows) {
    const c = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    const isReg = r.final ? (reg.has(r.final) ? 'KAYITLI' : 'kayitsiz') : '-';
    const flags = [
      r.was_corrected_by_user ? 'DUZ->' + r.corrected_to : '',
      !r.ocr_ok ? 'FAIL' : '',
      (r.final && r.plate_returned && r.final !== r.plate_returned) ? 'matcher' : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.t} | ${r.ocr_engine} | ham="${r.raw_text || ''}" | donen=${r.plate_returned || '-'} | final=${r.final || '-'}[${isReg}] | ${c} | ${r.elapsed_ms || '-'}ms | ${r.strategy || '-'}${flags ? ' | ' + flags : ''}${r.error ? ' | ERR:' + r.error : ''}`);
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
