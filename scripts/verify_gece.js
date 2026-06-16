// parktrack-backend içinde çalışır: health + gece_cetelesi migration/tablo doğrulaması.
const db = require('/app/backend/src/db');

(async () => {
  let health = 'ERR';
  try {
    const r = await fetch('http://localhost:3000/health');
    health = `${r.status} ${await r.text()}`;
  } catch (e) { health = 'ERR ' + e.message; }
  console.log('HEALTH:', health);

  const mig = await db('knex_migrations').where('name', 'like', '%gece_cetelesi%').first();
  console.log('MIGRATION:', mig ? `${mig.name} (batch ${mig.batch})` : 'YOK!');

  const reg = await db.raw("select to_regclass('public.gece_cetelesi') as t");
  console.log('TABLO:', reg.rows[0].t || 'YOK!');

  // Kolonlar + check constraint var mı (kabaca: insert/clamp dene değil, sadece say)
  const cols = await db.raw(
    "select column_name from information_schema.columns where table_name='gece_cetelesi' order by ordinal_position"
  );
  console.log('KOLONLAR:', cols.rows.map((c) => c.column_name).join(', '));

  const cnt = await db('gece_cetelesi').count('* as n').first();
  console.log('SATIR SAYISI:', cnt.n);

  await db.destroy();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
