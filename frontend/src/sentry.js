import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return null;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });

  return Sentry;
}

/**
 * Yutulmuş (try/catch'te yakalanıp kullanıcı akışını bozmayan) hataları
 * Sentry'ye gönder. DSN yoksa Sentry.init çağrılmamış olur ama
 * captureException yine güvenli no-op'tur. context → ek alanlar.
 */
export function captureException(err, context) {
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    /* Sentry hatasi kullanici akisini bozmamali */
  }
}
