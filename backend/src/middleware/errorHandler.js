function notFound(_req, res, _next) {
  res.status(404).json({ error: 'Bulunamadı.' });
}

function errorHandler(err, _req, res, _next) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[error]', err);
  }
  const status = err.status || err.statusCode || 500;
  // 5xx beklenmeyen sunucu hatasıdır — err.message iç detay (DB/şema/SQL
  // parçası) sızdırabilir. İstemciye jenerik mesaj, gerçeği yalnız log'a.
  if (status >= 500) {
    return res.status(status).json({ error: 'Sunucu hatası.' });
  }
  // 4xx kasıtlı, doğrulanmış hatalardır (.status set'li) — mesaj kullanıcıya
  // anlamlı, sızıntı yok.
  res.status(status).json({
    error: err.message || 'İstek işlenemedi.',
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFound, errorHandler };
