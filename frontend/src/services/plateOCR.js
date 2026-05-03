let workerPromise = null;

const PLATE_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const PLATE_PATTERNS = [
  /\b(\d{2}\s*[A-Z]{1,3}\s*\d{2,4})\b/,
  /\b(CC\s*\d{4,5})\b/,
  /\b(CD\s*\d{4,5})\b/,
];

async function imageToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(3, Math.max(1.5, 1800 / Math.max(bitmap.width, bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

async function makeHighContrastPlateImage(file) {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  const canvas = await imageToCanvas(file);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrasted = gray < 145 ? Math.max(0, gray - 45) : Math.min(255, gray + 65);
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
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

function extractPlate(rawText) {
  if (!rawText) return { guess: '', matched: false };
  const upper = rawText.toUpperCase().replace(/[^0-9A-Z\s\n]/g, ' ');
  for (const re of PLATE_PATTERNS) {
    const m = upper.match(re);
    if (m) return { guess: m[1].replace(/\s+/g, ''), matched: true };
  }
  const condensed = upper.replace(/\s+/g, '');
  const m2 = condensed.match(/(\d{2}[A-Z]{1,3}\d{2,4})/);
  if (m2) return { guess: m2[1], matched: true };
  return { guess: condensed.slice(0, 16), matched: false };
}

export async function recognizePlate(file) {
  const worker = await getWorker();
  let lastErr;
  const highContrast = await makeHighContrastPlateImage(file);
  const variants = [
    { name: 'high-contrast', image: highContrast },
    { name: 'original', image: file },
  ];
  for (const variant of variants) {
    for (const psm of ['7', '11', '6']) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const { data } = await worker.recognize(variant.image);
        const raw = (data?.text || '').trim();
        const { guess, matched } = extractPlate(raw);
        if (matched) {
          return { raw, guess, confidence: data?.confidence || 0, psm, variant: variant.name };
        }
        lastErr = { raw, guess, confidence: data?.confidence || 0, psm, variant: variant.name };
      } catch (err) {
        lastErr = { raw: '', guess: '', confidence: 0, error: err.message, psm, variant: variant.name };
      }
    }
  }
  return lastErr || { raw: '', guess: '', confidence: 0 };
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
