/**
 * Kullanıcı durumu cache'i (güvenlik — oturum iptali).
 *
 * authRequired her istekte kullanıcının hâlâ aktif olup olmadığını kontrol
 * eder ki deaktive edilen bir kullanıcı (ya da deaktif edilmiş bir site'nin
 * kullanıcısı) elindeki JWT ile token süresi (7 gün) boyunca erişimde
 * kalmasın. Rol/site bilgisi de canlı kayıttan okunur → orta-oturum
 * değişimleri anında yansır.
 *
 * DB'yi her istekte yormamak için kısa TTL'li in-memory cache. Deaktivasyon
 * gibi kritik değişimlerde invalidate() ile anında düşürülür; aksi halde en
 * geç TTL kadar gecikmeyle yansır.
 *
 * In-memory (tek instance varsayımı — loginLockout.js ile aynı). Fly'da
 * scale-out olursa Redis'e taşınmalı.
 */
const db = require('../db');

const TTL_MS = parseInt(process.env.USER_STATUS_TTL_MS || '30000', 10);

// userId → { at: ms, status: { aktif, rol, site_id, site_aktif } | null }
const _cache = new Map();

/**
 * Kullanıcının canlı durumunu döner (cache'li).
 * @param {number} userId
 * @returns {Promise<{aktif:boolean, rol:string, site_id:(number|null), site_aktif:(boolean|null)}|null>}
 *   Kullanıcı yoksa null. site_aktif: superadmin (site_id null) için null.
 */
async function getUserStatus(userId) {
  if (userId == null) return null;
  const now = Date.now();
  const cached = _cache.get(userId);
  if (cached && now - cached.at < TTL_MS) {
    return cached.status;
  }
  const row = await db('users')
    .leftJoin('sites', 'users.site_id', 'sites.id')
    .where('users.id', userId)
    .select(
      'users.aktif as aktif',
      'users.rol as rol',
      'users.site_id as site_id',
      'sites.aktif as site_aktif'
    )
    .first();
  const status = row
    ? {
        aktif: !!row.aktif,
        rol: row.rol,
        site_id: row.site_id ?? null,
        // Superadmin'in site'si yok → null (auth.js site_aktif===false'ta bloklar).
        site_aktif: row.site_id == null ? null : !!row.site_aktif,
      }
    : null;
  _cache.set(userId, { at: now, status });
  return status;
}

/** Kritik değişimde (deaktivasyon vb.) anında etki için cache'ten düş. */
function invalidate(userId) {
  if (userId != null) _cache.delete(userId);
}

/** Test hook'u. */
function _reset() {
  _cache.clear();
}

module.exports = { getUserStatus, invalidate, _reset, TTL_MS };
