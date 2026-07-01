// Dün akşamki (2026-06-30, TR) OCR okumalarını analiz et.
// Pencere: 2026-06-30 18:00 → 2026-07-01 02:00 (Europe/Istanbul).
const db = require('/app/backend/src/db');

const BASLA = "timestamp '2026-06-30 18:00' at time zone 'Europe/Istanbul'";
const BITIS = "timestamp '2026-07-01 02:00' at time zone 'Europe/Istanbul'";

(async () => {
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .whereRaw(`m.created_at >= ${BASLA} and m.created_at < ${BITIS}`)
    .orderBy('m.created_at', 'asc')
    .select(
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence', 'm.strategy',
      'm.elapsed_ms', 'm.ocr_ok', 'm.error', 'm.was_corrected_by_user', 'm.corrected_to',
      'm.local_match_source', 'm.local_match_score', 'm.local_match_plate',
      'k.plaka as final'
    );

  const finals = [...new Set(rows.map((r) => r.final).filter(Boolean))];
  const reg = new Set(finals.length
    ? await db('araclar').where('aktif', true).whereIn('plaka', finals).pluck('plaka') : []);

  let empty = 0, corrected = 0, failed = 0, changed = 0, registered = 0;
  let timeout = 0, http502 = 0, digerHata = 0;
  const strat = {};          // tam strateji kırılımı
  const src = {};            // local_match_source kırılımı
  const lat = [];
  for (const r of rows) {
    if (!r.plate_returned) empty++;
    if (r.was_corrected_by_user) corrected++;
    if (!r.ocr_ok) failed++;
    if (r.final && r.plate_returned && r.final !== r.plate_returned) changed++;
    if (r.final && reg.has(r.final)) registered++;
    if (typeof r.elapsed_ms === 'number') lat.push(r.elapsed_ms);

    const s = r.strategy || '(yok)';
    strat[s] = strat[s] || { n: 0, duz: 0 };
    strat[s].n++;
    if (r.was_corrected_by_user) strat[s].duz++;

    const ls = r.local_match_source || '(yok)';
    src[ls] = (src[ls] || 0) + 1;

    const e = (r.error || '').toLowerCase();
    if (e.includes('timeout')) timeout++;
    else if (e.includes('502')) http502++;
    else if (e) digerHata++;
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : null);

  console.log('=== DÜN AKŞAM (2026-06-30 18:00 → 07-01 02:00 TR) ÖZET ===');
  console.log(JSON.stringify({
    total: rows.length, plakaDonen: rows.length - empty, empty,
    matcherDegistirdi: changed, finalKayitli: registered, kullaniciDuzeltti: corrected,
    duzeltmeOrani: rows.length ? +(corrected / rows.length).toFixed(3) : null,
    failed, hatalar: { timeout, http502, diger: digerHata },
    latency_ms: { p50: pct(0.5), p95: pct(0.95), max: lat[lat.length - 1] || null },
  }, null, 2));

  console.log('\n=== STRATEJİ KIRILIMI (n / kullanıcı-düzeltti) ===');
  Object.entries(strat).sort((a, b) => b[1].n - a[1].n)
    .forEach(([k, v]) => console.log(`  ${k}: ${v.n} (${v.duz} düzeltme)`));

  console.log('\n=== LOCAL_MATCH_SOURCE (PR-öncesi yerel eşleşme) ===');
  Object.entries(src).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n=== TÜM OKUMALAR ===');
  for (const r of rows) {
    const c = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    const isReg = r.final ? (reg.has(r.final) ? 'KAYITLI' : 'kayitsiz') : '-';
    const lm = r.local_match_source
      ? ` | lm=${r.local_match_source}:${r.local_match_plate || '-'}(${r.local_match_score ?? '-'})` : '';
    const flags = [
      r.was_corrected_by_user ? 'DÜZ->' + r.corrected_to : '',
      !r.ocr_ok ? 'FAIL' : '',
      (r.final && r.plate_returned && r.final !== r.plate_returned) ? 'matcher' : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.t} | ham="${r.raw_text || ''}" | dönen=${r.plate_returned || '-'} | final=${r.final || '-'}[${isReg}] | ${c} | ${r.elapsed_ms || '-'}ms | ${r.strategy || '-'}${lm}${flags ? ' | ' + flags : ''}${r.error ? ' | ERR:' + r.error : ''}`);
  }
  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
