let workerPromise = null;

const PLATE_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const PLATE_PATTERNS = [
  /(?:^|[^A-Z0-9])(\d{2}\s*[A-Z]{1,3}\s*\d{2,4})(?:[^A-Z0-9]|$)/,
  /(?:^|[^A-Z0-9])(CC\s*\d{4,5})(?:[^A-Z0-9]|$)/,
  /(?:^|[^A-Z0-9])(CD\s*\d{4,5})(?:[^A-Z0-9]|$)/,
];

const TR_CITY_CODES = new Set();
for (let i = 1; i <= 81; i++) TR_CITY_CODES.add(String(i).padStart(2, '0'));

const CHAR_FIXES = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};
const REV_FIXES = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G',
};

async function bitmapFromFile(file) {
  return await createImageBitmap(file);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function makeScaledCanvas(file, targetMaxDim) {
  const bitmap = await bitmapFromFile(file);
  const scale = Math.min(targetMaxDim / Math.max(bitmap.width, bitmap.height), 3);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return c;
}

function applyHighContrast(canvas, threshold = 145, dark = 45, light = 65) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const c = g < threshold ? Math.max(0, g - dark) : Math.min(255, g + light);
    d[i] = d[i + 1] = d[i + 2] = c;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function applyAdaptiveThreshold(canvas, blockSize = 25, C = 12) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }

  const half = Math.floor(blockSize / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(w - 1, x + half);
      const y2 = Math.min(h - 1, y + half);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[(y1) * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + (x1)] +
        integral[(y1) * (w + 1) + (x1)];
      const mean = sum / area;
      const idx = (y * w + x) * 4;
      const v = gray[y * w + x] < mean - C ? 0 : 255;
      d[idx] = d[idx + 1] = d[idx + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist: PLATE_WHITELIST,
        tessedit_pageseg_mode: '11',
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

function fixPlateChars(s) {
  if (!s) return s;
  if (s.length < 5) return s;
  const fix = (ch, table) => table[ch] || ch;
  let out = '';
  let cityRead = '';
  let i = 0;
  while (i < 2 && i < s.length) {
    cityRead += fix(s[i], CHAR_FIXES);
    i++;
  }
  out += cityRead;
  let j = i;
  while (j < s.length && /[A-Z]/.test(fix(s[j], REV_FIXES))) {
    out += fix(s[j], REV_FIXES);
    j++;
    if (j - i >= 3) break;
  }
  while (j < s.length) {
    out += fix(s[j], CHAR_FIXES);
    j++;
  }
  return out;
}

export function extractPlate(rawText) {
  if (!rawText) return { guess: '', matched: false };

  const lines = rawText.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  const candidates = [];

  for (const rawLine of lines) {
    const cleaned = rawLine.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!cleaned || cleaned.length < 5) continue;

    const standardRe = /\d{2}[A-Z]{1,3}\d{2,4}/g;
    let m;
    while ((m = standardRe.exec(cleaned)) !== null) {
      const plate = m[0];
      const extraChars = cleaned.length - plate.length;
      if (TR_CITY_CODES.has(plate.slice(0, 2))) {
        candidates.push({ plate, length: plate.length, kind: 'standard', extraChars });
      }
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      const extraChars = cleaned.length - m[0].length;
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic', extraChars });
    }

    if (!/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            const extraChars = cleaned.length - fixed.length;
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed', extraChars });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.extraChars === 0 && b.extraChars > 0) return -1;
      if (a.extraChars > 0 && b.extraChars === 0) return 1;
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const fallback = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
    .join('')
    .slice(0, 16);
  return { guess: fallback, matched: false };
}
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      const isExact = cleaned.length === m[0].length;
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic', isExact });
    }

    if (!/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            const isExact = cleaned.length === fixed.length;
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed', isExact });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.isExact !== b.isExact) return (b.isExact ? 1 : 0) - (a.isExact ? 1 : 0);
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const fallback = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
    .join('')
    .slice(0, 16);
  return { guess: fallback, matched: false };
}
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      const hasExtraChars = m.index > 0 || m.index + m[0].length < cleaned.length;
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic', hasExtraChars });
    }

    if (!/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            const hasExtraChars = i > 0 || i + len < cleaned.length;
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed', hasExtraChars });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.hasExtraChars !== b.hasExtraChars) return (a.hasExtraChars ? 1 : 0) - (b.hasExtraChars ? 1 : 0);
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const fallback = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
    .join('')
    .slice(0, 16);
  return { guess: fallback, matched: false };
}
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic', line });
    }

    if (!/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed', line });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  return { guess: '', matched: false };
}
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic' });
    }

    if (cleaned.length <= 12 && !/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed' });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const allCleaned = rawText.replace(/[^0-9A-Z]/g, '').slice(0, 16);
  return { guess: allCleaned, matched: false };
}

async function ocrImage(image, psm) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(image);
  const raw = (data?.text || '').trim();
  const extracted = extractPlate(raw);
  return { raw, ...extracted, confidence: data?.confidence || 0, psm };
}

async function tryDetectionPipeline(file, onProgress) {
  let detector;
  try {
    onProgress?.('Plaka detector hazırlanıyor');
    detector = await import('./plateDetector');
  } catch {
    return null;
  }
  try {
    onProgress?.('Plaka adayları aranıyor (kenar + projeksiyon)');
    const candidates = await detector.detectPlateCandidates(file);
    onProgress?.(`${candidates?.length || 0} plaka adayı bulundu`);
    if (!candidates || candidates.length === 0) return null;

    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      onProgress?.(`Aday ${i + 1}/${candidates.length} OCR ediliyor`);
      try {
        const r = await ocrImage(cand.cropped, '7');
        if (r.matched) {
          return { ...r, source: 'detector', candidateIndex: i, candidateScore: cand.score };
        }
        if (!best || r.confidence > best.confidence) {
          best = { ...r, source: 'detector', candidateIndex: i, candidateScore: cand.score };
        }
      } catch (err) {
        if (!best) best = { raw: '', guess: '', confidence: 0, error: err.message, source: 'detector' };
      }
    }
    return best;
  } catch (err) {
    return { raw: '', guess: '', confidence: 0, error: 'Detector: ' + err.message, source: 'detector-error' };
  }
}

async function buildVariants(file, onProgress) {
  const variants = [];
  onProgress?.('Orijinal foto hazırlanıyor');
  const original = await makeScaledCanvas(file, 1800);
  variants.push({ name: 'original', image: original });

  onProgress?.('Yüksek kontrast varyant');
  const hc = await makeScaledCanvas(file, 1800);
  applyHighContrast(hc);
  variants.push({ name: 'high-contrast', image: hc });

  onProgress?.('Adaptive threshold varyant');
  const adapt = await makeScaledCanvas(file, 1800);
  applyAdaptiveThreshold(adapt, 31, 12);
  variants.push({ name: 'adaptive', image: adapt });

  onProgress?.('2x büyütülmüş varyant');
  const big = await makeScaledCanvas(file, 2600);
  applyHighContrast(big, 140, 35, 50);
  variants.push({ name: 'large-hc', image: big });

  return variants;
}

export async function recognizePlate(file, options = {}) {
  const { onProgress, usePlateDetector = true } = options;

  let detected = null;
  if (usePlateDetector) {
    try {
      detected = await Promise.race([
        tryDetectionPipeline(file, onProgress),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Detector zaman aşımı (15s)')), 15000)),
      ]);
    } catch (err) {
      detected = { raw: '', guess: '', confidence: 0, error: err.message, source: 'detector-error' };
    }
  }
  if (detected?.matched) return detected;

  let best = detected;
  let lastErr = detected;
  const variants = await buildVariants(file, onProgress);
  for (const variant of variants) {
    for (const psm of ['11', '7', '6', '12']) {
      onProgress?.(`OCR: ${variant.name} / PSM ${psm}`);
      try {
        const r = await ocrImage(variant.image, psm);
        if (r.matched) {
          return { ...r, source: 'fallback', variant: variant.name };
        }
        if (!best || r.confidence > (best.confidence || 0)) {
          best = { ...r, source: 'fallback', variant: variant.name };
        }
        if (!lastErr || r.confidence > (lastErr.confidence || 0)) {
          lastErr = best;
        }
      } catch (err) {
        if (!lastErr) lastErr = { raw: '', guess: '', confidence: 0, error: err.message, source: 'fallback', variant: variant.name };
      }
    }
  }
  return best || lastErr || { raw: '', guess: '', confidence: 0 };
}

export async function disposeOCR() {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {}
    workerPromise = null;
  }
}
