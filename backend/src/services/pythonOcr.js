/**
 * Python OCR microservice client.
 *
 * The Python service (backend/python_ocr) runs EasyOCR + OpenCV and exposes
 * POST /ocr taking a multipart "file" field. It returns
 *   { plate, confidence, strategy, elapsed_ms, raw_text }
 *
 * If the service is unreachable we return a soft-fail result rather than
 * blocking the upload — the user can still type the plate manually.
 */
const axios = require('axios');
const http = require('http');
const https = require('https');
const FormData = require('form-data');

const DEFAULT_URL = process.env.PYTHON_OCR_URL || 'http://python-ocr:5000';
const TIMEOUT_MS = parseInt(process.env.PYTHON_OCR_TIMEOUT_MS || '20000', 10);

// Short-lived agents — keep-alive was causing stuck-socket timeouts when the
// OCR machine restarted (backend was reusing dead TCP connections that hung
// silently for 180s). The 50-200ms handshake savings per request aren't
// worth the reliability hit.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

function isConfigured() {
  // We always treat the service as configured because the URL has a default,
  // but consumers should handle the case where it's unreachable.
  return Boolean(DEFAULT_URL);
}

async function recognizePlate(buffer, { filename = 'plate.jpg', mimeType = 'image/jpeg', debug = false } = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('recognizePlate: buffer required');
  }

  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });

  const url = `${DEFAULT_URL.replace(/\/$/, '')}/ocr${debug ? '?debug=true' : ''}`;
  try {
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      timeout: TIMEOUT_MS,
      maxBodyLength: 15 * 1024 * 1024,
      maxContentLength: 15 * 1024 * 1024,
      httpAgent,
      httpsAgent,
    });
    const data = response.data || {};
    return {
      ok: true,
      plate: (data.plate || '').toUpperCase(),
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      strategy: data.strategy || null,
      elapsedMs: data.elapsed_ms || null,
      rawText: data.raw_text || '',
      debug: data.debug || null,
    };
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.response?.data?.error || err.message;
    return {
      ok: false,
      plate: '',
      confidence: null,
      strategy: null,
      error: status ? `Python OCR ${status}: ${detail}` : `Python OCR unreachable: ${detail}`,
    };
  }
}

async function healthCheck() {
  try {
    const response = await axios.get(`${DEFAULT_URL.replace(/\/$/, '')}/health`, { timeout: 5000 });
    return { ok: true, ...response.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { recognizePlate, healthCheck, isConfigured };
