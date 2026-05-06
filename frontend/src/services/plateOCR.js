let workerPromise = null;

const PLATE_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Türk plaka formatları (toplam 6-9 karakter):
//   2 rakam + 1 harf + 4 rakam      → 34A1234
//   2 rakam + 2 harf + 2-4 rakam    → 34AB12, 34AB1234
//   2 rakam + 3 harf + 2-3 rakam    → 34ABC12, 34ABC123  (4 rakam YASAK)
const PLATE_BODY_SRC = '\\d{2}(?:[A-Z]\\d{4}|[A-Z]{2}\\d{2,4}|[A-Z]{3}\\d{2,3})';

const TR_CITY_CODES = new Set();
for (let i = 1; i <= 81; i++) TR_CITY_CODES.add(String(i).padStart(2, '0'));

const CHAR_FIXES = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
  Y: 'Y',
  D: '4', L: '1', M: 'W',
};
const REV_FIXES = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G',
  'K': 'Y',
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
  while (j < s.length && /[A-Z]/.test(fix(s[j], CHAR_FIXES))) {
    out += fix(s[j], CHAR_FIXES);
    j++;
    if (j - i >= 3) break;
  }
  while (j < s.length) {
    out += fix(s[j], CHAR_FIXES);
    j++;
  }
  return out;
}

const PLATE_BODY_EXACT = new RegExp(`^${PLATE_BODY_SRC}$`);

function collectFromCleaned(cleaned, numLines, candidates, source) {
  if (!cleaned || cleaned.length < 5) return;

  // Just try ALL substrings of the cleaned string
  for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
    for (let i = 0; i + len <= cleaned.length; i++) {
      const sub = cleaned.slice(i, i + len);
      if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
      const fixed = fixPlateChars(sub);
      if (PLATE_BODY_EXACT.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
        candidates.push({
          plate: fixed,
          length: fixed.length,
          kind: 'substring',
          extraChars: cleaned.length - fixed.length,
          numLines,
          source,
        });
      }
    }
  }
}

function tokensFromWords(words) {
  // Tesseract bazen alt satırdaki karakteri (örn. plate-altı çıkartmadaki bir
  // rakam) aynı word'e dahil eder; o zaman word-level bbox tek satır gibi
  // görünür. Symbol-level (karakter başı) bbox varsa onu kullan ki gerçek
  // y-pozisyonuna göre satırlara ayrılabilsin.
  const tokens = [];
  for (const w of words || []) {
    if (!w || !w.bbox || typeof w.text !== 'string') continue;
    const symbols = Array.isArray(w.symbols) ? w.symbols : null;
    if (symbols && symbols.length > 0) {
      for (const s of symbols) {
        if (!s || !s.bbox || typeof s.text !== 'string') continue;
        tokens.push({
          text: s.text,
          cy: (s.bbox.y0 + s.bbox.y1) / 2,
          h: Math.max(1, s.bbox.y1 - s.bbox.y0),
          x0: s.bbox.x0,
        });
      }
    } else {
      tokens.push({
        text: w.text,
        cy: (w.bbox.y0 + w.bbox.y1) / 2,
        h: Math.max(1, w.bbox.y1 - w.bbox.y0),
        x0: w.bbox.x0,
      });
    }
  }
  return tokens;
}

function rowsFromWords(words) {
  const items = tokensFromWords(words).sort((a, b) => a.cy - b.cy);
  if (items.length === 0) return [];

  const rows = [];
  let current = [items[0]];
  let rowCy = items[0].cy;
  let rowH = items[0].h;
  for (let i = 1; i < items.length; i++) {
    const w = items[i];
    const threshold = Math.max(rowH, w.h) * 0.6;
    if (Math.abs(w.cy - rowCy) <= threshold) {
      current.push(w);
      rowCy = (rowCy * (current.length - 1) + w.cy) / current.length;
      rowH = Math.max(rowH, w.h);
    } else {
      rows.push(current);
      current = [w];
      rowCy = w.cy;
      rowH = w.h;
    }
  }
  rows.push(current);

  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text.toUpperCase().replace(/[^0-9A-Z]/g, ''))
        .filter(Boolean)
        .join(''),
    )
    .filter(Boolean);
}

export function extractPlate(rawText, words = null) {
  const candidates = [];

  const visualRows = rowsFromWords(words);
  for (const row of visualRows) {
    collectFromCleaned(row, 1, candidates, 'visual');
  }

  const lines = (rawText || '').split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  const cleanedLines = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean);

  for (const cleaned of cleanedLines) {
    collectFromCleaned(cleaned, 1, candidates, 'text');
  }

  // Last resort: join adjacent text lines (some PSM modes split a single
  // visual row across multiple text lines). Prefer the FEWEST joined
  // lines that produce an exact plate match — adding rows below shouldn't
  // extend the plate.
  for (let start = 0; start < cleanedLines.length; start++) {
    let joined = cleanedLines[start];
    for (let end = start + 1; end < cleanedLines.length; end++) {
      joined += cleanedLines[end];
      if (joined.length > 12) break;
      const numLines = end - start + 1;
      const std = joined.match(PLATE_BODY_EXACT);
      if (std && TR_CITY_CODES.has(std[0].slice(0, 2))) {
        candidates.push({
          plate: std[0],
          length: std[0].length,
          kind: 'joined',
          extraChars: 0,
          numLines,
          source: 'joined',
        });
      }
      const dipl = joined.match(/^((?:CC|CD)\d{4,5})$/);
      if (dipl) {
        candidates.push({
          plate: dipl[1],
          length: dipl[1].length,
          kind: 'joined-diplomatic',
          extraChars: 0,
          numLines,
          source: 'joined',
        });
      }
    }
  }

  if (candidates.length > 0) {
    const sourceRank = { visual: 0, text: 1, joined: 2 };
    candidates.sort((a, b) => {
      // Exact match (no extra chars on its row) wins.
      if (a.extraChars === 0 && b.extraChars > 0) return -1;
      if (a.extraChars > 0 && b.extraChars === 0) return 1;
      // Bbox-derived visual rows are authoritative — prefer them over
      // text-line analysis, which can't tell when a "5" is one row below.
      const sa = sourceRank[a.source] ?? 9;
      const sb = sourceRank[b.source] ?? 9;
      if (sa !== sb) return sa - sb;
      // Prefer fewer joined lines — don't pull characters from other rows.
      const an = a.numLines || 1;
      const bn = b.numLines || 1;
      if (an !== bn) return an - bn;
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, joined: 1, fixed: 2, diplomatic: 3, 'joined-diplomatic': 4 };
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const fallback = cleanedLines.join('').slice(0, 16);
  return { guess: fallback, matched: false };
}

function flattenWords(data) {
  const out = [];
  if (Array.isArray(data?.words)) out.push(...data.words);
  for (const block of data?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) {
        for (const w of line?.words || []) out.push(w);
      }
    }
  }
  return out;
}

async function ocrImage(image, psm) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const raw = (data?.text || '').trim();
  const words = flattenWords(data);
  const extracted = extractPlate(raw, words);
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
