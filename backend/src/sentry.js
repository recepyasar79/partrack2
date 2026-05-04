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
    beforeSend(event) {
      if (event.request && event.request.headers) {
        delete event.request.headers;
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
