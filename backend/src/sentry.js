const Sentry = require('@sentry/node');

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN yok, Sentry aktif degil.');
    return null;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Hata bağlamından PII/sırrı çıkar: header (Authorization token),
      // gövde (telefon/plaka) ve cookie. Yalnız method/url kalsın.
      if (event.request) {
        delete event.request.headers;
        delete event.request.data;
        delete event.request.cookies;
      }
      return event;
    },
  });

  console.log('[sentry] Sentry baslatildi.');
  return Sentry;
}

function sentryErrorMiddleware() {
  return Sentry.requestHandler ? Sentry.requestHandler() : (req, res, next) => next();
}

function sentryTracingMiddleware() {
  return Sentry.tracingHandler ? Sentry.tracingHandler() : (req, res, next) => next();
}

function sentryErrorHandler() {
  return Sentry.errorHandler ? Sentry.errorHandler() : (err, req, res, next) => next(err);
}

module.exports = { initSentry, sentryErrorMiddleware, sentryTracingMiddleware, sentryErrorHandler, Sentry };
