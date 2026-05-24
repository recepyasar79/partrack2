/**
 * Plate Recognizer Snapshot Cloud API client.
 *
 * Cache-first OCR akışının 4. (son) katmanı. Python OCR + plate_learnings
 * cache miss verirse buraya gelinir. FREE tier 2.500 lookup/ay, SMALL
 * $50/ay 50.000 lookup. Her çağrı maliyet — sadece local katmanlar
 * tükenince çağırıyoruz.
 *
 * API dokümantasyonu: https://docs.platerecognizer.com/?javascript#license-plate-recognition
 *
 * Konfigürasyon (env):
 *   PLATE_RECOGNIZER_API_KEY   — zorunlu, secret
 *   PLATE_RECOGNIZER_API_URL   — opsiyonel, varsayılan public endpoint
 *   PLATE_RECOGNIZER_REGIONS   — opsiyonel, varsayılan 'tr' (Türk plakaları)
 *   PLATE_RECOGNIZER_TIMEOUT_MS — opsiyonel, varsayılan 15000
 */
const axios = require('axios');
const http = require('http');
const https = require('https');
const FormData = require('form-data');

const DEFAULT_URL = process.env.PLATE_RECOGNIZER_API_URL || 'https://api.platerecognizer.com/v1/plate-reader/';
const API_KEY = process.env.PLATE_RECOGNIZER_API_KEY || '';
const REGIONS = process.env.PLATE_RECOGNIZER_REGIONS || 'tr';
const TIMEOUT_MS = parseInt(process.env.PLATE_RECOGNIZER_TIMEOUT_MS || '15000', 10);

// pythonOcr.js'deki keepAlive=false kararıyla aynı mantık — restart sonrası
// stale TCP soket riski tek el sıkışma kazancından daha pahalı.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

function isConfigured() {
  return Boolean(API_KEY);
}

/**
 * Görüntüyü Plate Recognizer'a gönderir, en iyi plakayı döner.
 * Hata durumunda { ok: false, error } — caller fallback'e geçer.
 *
 * @param {Buffer} buffer
 * @param {{ filename?: string, mimeType?: string }} opts
 * @returns {Promise<{ ok: boolean, plate?: string, score?: number, dscore?: number, raw?: object, elapsedMs?: number, error?: string }>}
 */
async function recognizePlate(buffer, { filename = 'plate.jpg', mimeType = 'image/jpeg' } = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('plateRecognizer.recognizePlate: buffer required');
  }
  if (!API_KEY) {
    return { ok: false, error: 'PLATE_RECOGNIZER_API_KEY not set' };
  }

  const form = new FormData();
  form.append('upload', buffer, { filename, contentType: mimeType });
  form.append('regions', REGIONS);

  const started = Date.now();
  try {
    const response = await axios.post(DEFAULT_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Token ${API_KEY}`,
      },
      timeout: TIMEOUT_MS,
      maxBodyLength: 15 * 1024 * 1024,
      maxContentLength: 15 * 1024 * 1024,
      httpAgent,
      httpsAgent,
    });
    const data = response.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    // En yüksek "score" (recognition confidence) olan sonucu seç.
    let best = null;
    for (const r of results) {
      if (!r || !r.plate) continue;
      if (!best || (r.score || 0) > (best.score || 0)) best = r;
    }
    if (!best) {
      return {
        ok: false,
        error: 'No plate detected',
        raw: data,
        elapsedMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      plate: String(best.plate || '').toUpperCase(),
      score: best.score ?? null,        // recognition confidence (0..1)
      dscore: best.dscore ?? null,      // detection confidence (0..1)
      box: best.box || null,
      raw: data,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const status = err.response?.status;
    const detail =
      err.response?.data?.detail ||
      err.response?.data?.error ||
      err.message ||
      err.code ||
      err.cause?.message ||
      err.cause?.code ||
      err.name ||
      'unknown';
    console.error('[plateRecognizer] request failed:', {
      status,
      code: err.code,
      cause_code: err.cause?.code,
      message: err.message,
    });
    return {
      ok: false,
      error: status ? `PlateRecognizer ${status}: ${detail}` : `PlateRecognizer unreachable: ${detail}`,
      elapsedMs: Date.now() - started,
    };
  }
}

module.exports = { recognizePlate, isConfigured };
