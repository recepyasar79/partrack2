const { hashPassword } = require('../../backend/src/utils/auth');

exports.seed = async function (knex) {
  if (process.env.NODE_ENV === 'production') {
    console.log('[seed] Production ortamında örnek veri atlanıyor.');
    return;
  }

  const guvenlik = await knex('users').where({ kullanici_adi: 'guvenlik1' }).first();
  if (!guvenlik) {
    await knex('users').insert({
      kullanici_adi: 'guvenlik1',
      sifre_hash: await hashPassword('Guvenlik123!'),
      rol: 'guvenlik',
      aktif: true,
    });
  }

  const ornekDaireler = [
    { daire_no: 'A1', sahip_ad: 'Ali Yılmaz', sahip_tel: '05551110001' },
    { daire_no: 'A2', sahip_ad: 'Ayşe Demir', sahip_tel: '05551110002' },
    { daire_no: 'B3', sahip_ad: 'Mehmet Kaya', sahip_tel: '05551110003' },
    { daire_no: 'B5', sahip_ad: 'Fatma Çelik', sahip_tel: '05551110004' },
    { daire_no: 'C10', sahip_ad: 'Hasan Şahin', sahip_tel: '05551110005' },
    { daire_no: 'D17', sahip_ad: 'Zeynep Arslan', sahip_tel: '05551110006' },
  ];

  for (const d of ornekDaireler) {
    const exist = await knex('daireler').where({ daire_no: d.daire_no }).first();
    if (exist) continue;
    await knex('daireler').insert({
      daire_no: d.daire_no,
      blok: d.daire_no[0],
      sira_no: parseInt(d.daire_no.slice(1), 10),
      sahip_ad: d.sahip_ad,
      sahip_tel: d.sahip_tel,
      kvkk_riza: true,
      kvkk_riza_tarihi: knex.fn.now(),
      bildirim_opt_in: true,
      aktif: true,
    });
  }

  const ornekAraclar = [
    { daire_no: 'A1', plaka: '34ABC101' },
    { daire_no: 'A1', plaka: '06DEF202' },
    { daire_no: 'B3', plaka: '34GHI303' },
    { daire_no: 'B5', plaka: '34JKL404' },
    { daire_no: 'B5', plaka: '34MNO505' },
    { daire_no: 'C10', plaka: '07PQR606' },
  ];

  for (const a of ornekAraclar) {
    const daire = await knex('daireler').where({ daire_no: a.daire_no }).first();
    if (!daire) continue;
    const exist = await knex('araclar').where({ plaka: a.plaka, aktif: true }).first();
    if (exist) continue;
    await knex('araclar').insert({
      daire_id: daire.id,
      plaka: a.plaka,
      aktif: true,
    });
  }

  console.log('[seed] Geliştirme örnek verisi hazır.');
};
