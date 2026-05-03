function notFound(_req, res, _next) {
  res.status(404).json({ error: 'Bulunamadı.' });
}

function errorHandler(err, _req, res, _next) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[error]', err);
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Sunucu hatası.',
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFound, errorHandler };
