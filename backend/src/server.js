require('dotenv').config({ path: '../.env' });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const { initSentry, sentryErrorMiddleware, sentryTracingMiddleware, sentryErrorHandler } = require('./sentry');

const path = require('path');

const sentry = initSentry();

const authRoutes = require('./routes/auth');
const daireRoutes = require('./routes/daireler');
const aracRoutes = require('./routes/araclar');
const misafirRoutes = require('./routes/misafirAraclar');
const auditRoutes = require('./routes/auditLog');
const kontrolRoutes = require('./routes/kontroller');
const { router: analizRoutes } = require('./routes/analiz');
const bildirimRoutes = require('./routes/bildirimler');
const ocrStatsRoutes = require('./routes/ocrStats');
const sitesRoutes = require('./routes/sites');
const siteUsageRoutes = require('./routes/siteUsage');
const subscriptionRoutes = require('./routes/subscription');
const webhookRoutes = require('./routes/webhooks');
const { isR2Configured } = require('./services/storage');

const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(sentryTracingMiddleware());

// Webhook'lar — signature verify için raw body gerekli; json middleware'den
// ve rate limit'ten ÖNCE mount edilir (provider retry'lar engellenmesin).
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '256kb' }), webhookRoutes);

app.use(express.json({ limit: '1mb' }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', generalLimiter);

app.get('/health', async (_req, res) => {
  const out = { status: 'ok', time: new Date().toISOString() };
  try {
    await db.raw('select 1');
    out.db = 'ok';
  } catch (err) {
    out.status = 'degraded';
    out.db = 'down';
    out.db_error = err.message;
  }
  out.storage = isR2Configured() ? 'r2' : 'disk';
  out.whatsapp = process.env.WHATSAPP_API_TOKEN ? 'configured' : 'mock';
  res.status(out.status === 'ok' ? 200 : 503).json(out);
});

app.get('/api', (_req, res) => {
  res.json({ name: 'ParkTrack API', version: '0.1.0' });
});

app.use('/api/auth', authRoutes);
app.use('/api/daireler', daireRoutes);
app.use('/api/araclar', aracRoutes);
app.use('/api/misafir-araclar', misafirRoutes);
app.use('/api/audit-log', auditRoutes);
app.use('/api/kontroller', kontrolRoutes);
app.use('/api/kontroller', analizRoutes);
app.use('/api/bildirimler', bildirimRoutes);
app.use('/api/ocr-stats', ocrStatsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/site-usage', siteUsageRoutes);
app.use('/api/site/subscription', subscriptionRoutes);

if (!isR2Configured()) {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
  app.use('/uploads', express.static(uploadDir));
}

app.use(notFound);
app.use(sentryErrorHandler());
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ParkTrack API çalışıyor: http://localhost:${PORT}`);
  });
}

module.exports = app;
