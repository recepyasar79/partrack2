const { verifyToken } = require('../utils/auth');

/**
 * JWT'yi doğrular, req.user'a payload'ı yerleştirir. Payload yapısı:
 *   { id, kullanici_adi, rol, site_id }
 * site_id NULL → superadmin (tüm sitelere erişir)
 * site_id dolu → bir site'ye bağlı user (site_yonetici veya guvenlik)
 *
 * Convenience getter: req.siteId — middleware'ler ve route'lar bunu okur.
 * Superadmin için req.siteId === null; query param ile geçici scope:
 * superadmin '?siteId=42' geçerek başka site verisine bakabilir
 * (Ü1.4 route layer'da zorla).
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Yetkilendirme gerekli.' });
  try {
    const payload = verifyToken(token);
    req.user = payload;
    // Superadmin için null; aksi halde JWT'den gelen site_id.
    req.siteId = payload.site_id ?? null;
    next();
  } catch {
    return res.status(401).json({ error: 'Geçersiz veya süresi geçmiş oturum.' });
  }
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
