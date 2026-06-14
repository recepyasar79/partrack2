const { verifyToken } = require('../utils/auth');
const { getUserStatus } = require('../utils/userStatusCache');

/**
 * JWT'yi doğrular VE kullanıcının hâlâ aktif olduğunu canlı kayıttan teyit
 * eder, sonra req.user'ı kurar:
 *   { id, kullanici_adi, rol, site_id }
 * site_id NULL → superadmin; dolu → site-bağlı user.
 *
 * Kimlik (id/kullanici_adi) imzalı token'dan, OTORİTE (rol/site_id/aktiflik)
 * canlı DB'den gelir (kısa TTL cache). Böylece deaktive edilen kullanıcı ya
 * da deaktif site'nin kullanıcısı token süresi (7g) boyunca erişimde kalmaz;
 * rol/site değişimi de oturum ortasında anında yansır.
 *
 * Convenience getter: req.siteId — middleware'ler ve route'lar bunu okur.
 */
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Yetkilendirme gerekli.' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Geçersiz veya süresi geçmiş oturum.' });
  }

  let status;
  try {
    status = await getUserStatus(payload.id);
  } catch (err) {
    // Geçici DB hatası: herkesi 401 ile login'e atmaktansa 503 dön. Frontend
    // 401'de oturumu kapatıyor; DB blip'inde aktif oturumları düşürmeyelim.
    console.error('[auth] kullanıcı durumu sorgulanamadı:', err.message);
    return res.status(503).json({ error: 'Servis geçici olarak kullanılamıyor.' });
  }

  if (!status || status.aktif === false) {
    return res.status(401).json({ error: 'Oturum geçersiz. Lütfen tekrar giriş yapın.' });
  }
  // Site-bağlı kullanıcının site'si deaktif edilmişse erişimi kes.
  if (status.rol !== 'superadmin' && status.site_aktif === false) {
    return res.status(401).json({ error: 'Oturum geçersiz. Lütfen tekrar giriş yapın.' });
  }

  req.user = {
    id: payload.id,
    kullanici_adi: payload.kullanici_adi,
    rol: status.rol,
    site_id: status.site_id ?? null,
  };
  req.siteId = status.site_id ?? null;
  next();
}

/**
 * Belirtilen rollerden birini gerektirir.
 * Örn: requireRole('site_yonetici') veya requireRole('site_yonetici', 'superadmin')
 */
function requireRole(...roller) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli.' });
    if (!roller.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
    }
    next();
  };
}

/** Sadece superadmin — platform sahibi işlemleri (site CRUD, faturalama). */
function requireSuperadmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli.' });
  if (req.user.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Bu işlem yalnızca platform yöneticilerine açıktır.' });
  }
  next();
}

/**
 * Site yöneticisi (sadece site_yonetici). Domain-içi mutating işlemler için.
 *
 * NOT: Superadmin BURAYA DAHİL DEĞİL — platform sahibi olarak müşteri
 * sitelerinin domain verisini (daire/araç/foto/sahip bilgisi) görmemeli
 * ve değiştirmemeli. KVKK + müşteri güveni açısından kritik. Süper-admin
 * kullanıcı ekleme/site oluşturma gibi platform işlerini /sites/* üzerinden
 * yapar.
 */
function requireSiteAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli.' });
  if (req.user.rol !== 'site_yonetici') {
    return res.status(403).json({ error: 'Bu işlem için site yöneticisi yetkisi gerekli.' });
  }
  next();
}

/**
 * Superadmin'in başka bir site'nin verisine bakması için ?siteId query
 * parametresi destekleyen helper. Çağıran route'ta resolvedSiteId değişkeni
 * için kullanılır:
 *   const siteId = resolveScopedSiteId(req);
 *   if (siteId == null) return res.status(400).json({ error: 'site_id gerekli' });
 *
 * Mantık:
 *   - site_yonetici / guvenlik: kendi site'sini döner (req.user.site_id),
 *     query param yoksayılır.
 *   - superadmin + ?siteId verilmiş: o site_id dönülür.
 *   - superadmin + ?siteId yok: null döner (route karar verir; bazı
 *     superadmin route'lar cross-site agg yapar, bazıları zorunlu kılar).
 */
function resolveScopedSiteId(req) {
  if (!req.user) return null;
  // Superadmin domain verisine erişemez (platform katmanı izolasyonu).
  // /sites/* endpoint'leri kendi site_id'sini path'ten alır, scope helper'a
  // ihtiyaç duymaz.
  if (req.user.rol === 'superadmin') return null;
  return req.user.site_id ?? null;
}

/**
 * Domain route'larının çoğu için gerekli: bir site_id zorunlu olsun.
 * Yalnız site_yonetici ve guvenlik (site-bağlı user'lar) geçer.
 * Superadmin domain verisine erişemez (platform katmanı izolasyonu) → 403.
 */
function requireScopedSite(req, res, next) {
  if (req.user?.rol === 'superadmin') {
    return res.status(403).json({
      error: 'Platform yöneticileri site verisine erişemez. Site yönetimi için /sites endpoint\'lerini kullanın.',
    });
  }
  const siteId = resolveScopedSiteId(req);
  if (siteId == null) {
    return res.status(400).json({ error: 'site_id gerekli.' });
  }
  req.scopedSiteId = siteId;
  next();
}

module.exports = {
  authRequired,
  requireRole,
  requireSuperadmin,
  requireSiteAdmin,
  resolveScopedSiteId,
  requireScopedSite,
};
