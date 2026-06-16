// Belirli plaka vakalarının ocr_metrics izini çek: ham OCR → dönen → final →
// strateji. OCR hatası mı (ham zaten yanlış) yoksa matcher hatası mı (ham
// yakın ama yanlış kayıtlıya snap) ayrımını görmek için.
const db = require('/app/backend/src/db');

const wrongs = ['02IG5615','10TR0545','34CTM124','43I7011','02YUZ85','070TV07','11ERO130','49T0M07','700Z81'];
const corrects = ['34DLG476','10AHU314','34DLN932','34FLV170','34HNS380','34TV2580','34BRY311','34CZN449','34EZZ390'];
const targets = [...wrongs, ...corrects];

(async () => {
  const rows = await db('ocr_metrics as m')
    .leftJoin('gunluk_kontroller as k', 'm.gunluk_kontrol_id', 'k.id')
    .where((q) => q.whereIn('m.plate_returned', targets)
                   .orWhereIn('k.plaka', targets)
                   .orWhereIn('m.corrected_to', targets))
    .orderBy('m.created_at', 'asc')
    .select(
      db.raw("to_char(m.created_at at time zone 'Europe/Istanbul','HH24:MI:SS') as t"),
      'm.ocr_engine', 'm.raw_text', 'm.plate_returned', 'm.confidence',
      'm.strategy', 'm.elapsed_ms', 'm.was_corrected_by_user', 'm.corrected_to',
      'k.plaka as final'
    );

  // Hangi correct plakalar gerçekten kayıtlı (araclar.aktif)? Matcher'ın
  // doğru hedefi seçebilmesi için kayıtlı olması gerek.
  const reg = await db('araclar').where('aktif', true).whereIn('plaka', targets).pluck('plaka');
  const regSet = new Set(reg);

  console.log('=== KAYITLI MI? ===');
  for (const p of corrects) console.log(`${p}: ${regSet.has(p) ? 'KAYITLI' : 'kayitsiz'}`);
  for (const p of wrongs) if (regSet.has(p)) console.log(`(yanlis) ${p}: KAYITLI!`);

  console.log('\n=== IZLER (zaman sirasi) ===');
  for (const r of rows) {
    const conf = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-';
    console.log(
      `${r.t} | eng=${r.ocr_engine} | ham="${r.raw_text || ''}" | donen=${r.plate_returned || '-'} | final=${r.final || '-'} | conf=${conf} | strat=${r.strategy || '-'}${r.was_corrected_by_user ? ' | DUZ->' + r.corrected_to : ''}`
    );
  }
  console.log('\ntoplam satir:', rows.length);
  await db.destroy();
})().catch((e) => { console.error('HATA:', e); process.exit(1); });
