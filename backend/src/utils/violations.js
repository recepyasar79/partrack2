const { normalizePlaka } = require('./validators');

function detectViolations({ plakalar, plakaToDaire, misafirPlakaToDaire = new Map(), misafirPlakalar = new Set() }) {
  const seen = new Set();
  const dairePlakalar = new Map();
  const kayitsizPlakalar = [];
  const legacyMisafirSet = misafirPlakalar instanceof Set ? misafirPlakalar : new Set();

  for (const raw of plakalar) {
    const p = normalizePlaka(raw);
    if (!p || seen.has(p)) continue;
    seen.add(p);

    if (!misafirPlakaToDaire.has(p) && legacyMisafirSet.has(p)) continue;

    const misafirDaire = misafirPlakaToDaire.get(p);
    const daire = misafirDaire || plakaToDaire.get(p);
    const misafir = !!misafirDaire || legacyMisafirSet.has(p);
    if (!daire) {
      kayitsizPlakalar.push(p);
      continue;
    }
    const arr = dairePlakalar.get(daire.daire_id) || { daire, plakalar: [], misafirPlakalar: [] };
    arr.plakalar.push(p);
    if (misafir) arr.misafirPlakalar.push(p);
    dairePlakalar.set(daire.daire_id, arr);
  }

  const ihlalYapanDaireler = [];
  for (const { daire, plakalar: ps, misafirPlakalar: ms } of dairePlakalar.values()) {
    if (ps.length > 1) {
      ihlalYapanDaireler.push({
        daire_id: daire.daire_id,
        daire_no: daire.daire_no,
        sahip_ad: daire.sahip_ad,
        sahip_tel: daire.sahip_tel,
        bildirim_opt_in: daire.bildirim_opt_in,
        plakalar: ps,
        misafir_plakalar: ms,
      });
    }
  }

  return { ihlalYapanDaireler, kayitsizPlakalar };
}

module.exports = { detectViolations };
