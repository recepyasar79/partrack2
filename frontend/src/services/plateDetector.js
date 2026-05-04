// Saf JS plaka detector — OpenCV/WASM yok.
// Pipeline: grayscale → vertical Sobel → row edge projection → band detection
// → column projection → bound detection → aspect filter → crop top candidates.

const TARGET_MAX_DIM = 1400;
const PLATE_HEIGHT_MIN_RATIO = 0.012;
const PLATE_HEIGHT_MAX_RATIO = 0.30;
const ASPECT_MIN = 2.0;
const ASPECT_MAX = 7.0;
const ASPECT_IDEAL = 4.7;
const MAX_CANDIDATES = 4;
const CROP_PADDING = 0.06;
const CROP_TARGET_HEIGHT = 220;

async function fileToImageData(file, maxDim = TARGET_MAX_DIM) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, w, h), width: w, height: h };
}

function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return gray;
}

function verticalSobel(gray, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[(y - 1) * width + (x - 1)] +
        gray[(y - 1) * width + (x + 1)] +
        -2 * gray[y * width + (x - 1)] +
        2 * gray[y * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] +
        gray[(y + 1) * width + (x + 1)];
      const v = Math.abs(gx);
      out[i] = v > 255 ? 255 : v;
    }
  }
  return out;
}

function thresholdEdges(edges, threshold) {
  const out = new Uint8Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    out[i] = edges[i] > threshold ? 1 : 0;
  }
  return out;
}

function smooth1D(arr, window) {
  const out = new Float32Array(arr.length);
  const half = Math.floor(window / 2);
  let sum = 0;
  for (let i = 0; i < window && i < arr.length; i++) sum += arr[i];
  for (let i = 0; i < arr.length; i++) {
    out[i] = sum / window;
    if (i >= half && i + half + 1 < arr.length) {
      sum += arr[i + half + 1] - arr[i - half];
    }
  }
  return out;
}

function rowProjection(binary, width, height) {
  const proj = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) count += binary[row + x];
    proj[y] = count;
  }
  return proj;
}

function colProjection(binary, width, yStart, yEnd) {
  const proj = new Uint32Array(width);
  for (let y = yStart; y <= yEnd; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) proj[x] += binary[row + x];
  }
  return proj;
}

function meanStd(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let varSum = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / arr.length);
  return { mean, std };
}

function findBands(smoothedProj, threshold, minHeight, maxHeight) {
  const bands = [];
  let inBand = false;
  let bandStart = 0;
  let bandPeak = 0;
  for (let y = 0; y < smoothedProj.length; y++) {
    const v = smoothedProj[y];
    if (v >= threshold) {
      if (!inBand) {
        inBand = true;
        bandStart = y;
        bandPeak = v;
      } else if (v > bandPeak) {
        bandPeak = v;
      }
    } else if (inBand) {
      const bandEnd = y - 1;
      const bandHeight = bandEnd - bandStart + 1;
      if (bandHeight >= minHeight && bandHeight <= maxHeight) {
        bands.push({ yStart: bandStart, yEnd: bandEnd, height: bandHeight, peak: bandPeak });
      }
      inBand = false;
    }
  }
  if (inBand) {
    const bandEnd = smoothedProj.length - 1;
    const bandHeight = bandEnd - bandStart + 1;
    if (bandHeight >= minHeight && bandHeight <= maxHeight) {
      bands.push({ yStart: bandStart, yEnd: bandEnd, height: bandHeight, peak: bandPeak });
    }
  }
  return bands;
}

function findHorizontalBounds(colProj, threshold) {
  const segments = [];
  let inSeg = false;
  let segStart = 0;
  let segPeak = 0;
  let lastBelowAt = -1;

  for (let x = 0; x < colProj.length; x++) {
    const v = colProj[x];
    if (v >= threshold) {
      if (!inSeg) {
        inSeg = true;
        segStart = x;
        segPeak = v;
      } else if (v > segPeak) {
        segPeak = v;
      }
      lastBelowAt = -1;
    } else {
      if (inSeg) {
        if (lastBelowAt < 0) lastBelowAt = x;
        if (x - lastBelowAt > 8) {
          segments.push({ xStart: segStart, xEnd: lastBelowAt - 1, peak: segPeak });
          inSeg = false;
        }
      }
    }
  }
  if (inSeg) {
    segments.push({ xStart: segStart, xEnd: colProj.length - 1, peak: segPeak });
  }
  return segments;
}

function cropFromCanvas(srcCanvas, rect, scaleTargetH = CROP_TARGET_HEIGHT) {
  const padX = Math.round(rect.width * CROP_PADDING);
  const padY = Math.round(rect.height * CROP_PADDING * 1.5);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  const w = Math.min(srcCanvas.width - x, rect.width + 2 * padX);
  const h = Math.min(srcCanvas.height - y, rect.height + 2 * padY);

  const scale = scaleTargetH / h;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const data = img.data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += g;
  }
  const mean = sum / (data.length / 4);
  const t = Math.max(80, Math.min(180, mean - 15));
  for (let i = 0; i < data.length; i += 4) {
    const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const v = g < t ? Math.max(0, g - 35) : Math.min(255, g + 50);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export async function detectPlateCandidates(file) {
  const { canvas, width, height } = await fileToImageData(file);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);

  const gray = toGrayscale(imageData);
  const edges = verticalSobel(gray, width, height);

  const { mean: edgeMean, std: edgeStd } = meanStd(edges);
  const edgeThreshold = Math.min(255, edgeMean + edgeStd * 0.7);
  const binary = thresholdEdges(edges, edgeThreshold);

  const rowProj = rowProjection(binary, width, height);
  const rowSmooth = smooth1D(rowProj, Math.max(5, Math.round(height * 0.012)));

  const { mean: rowMean, std: rowStd } = meanStd(rowSmooth);
  const rowThreshold = rowMean + rowStd * 0.55;

  const minBandH = Math.max(8, Math.round(height * PLATE_HEIGHT_MIN_RATIO));
  const maxBandH = Math.round(height * PLATE_HEIGHT_MAX_RATIO);

  const bands = findBands(rowSmooth, rowThreshold, minBandH, maxBandH);

  const candidates = [];
  for (const band of bands) {
    const colProj = colProjection(binary, width, band.yStart, band.yEnd);
    const colSmooth = smooth1D(colProj, 7);
    const { mean: colMean, std: colStd } = meanStd(colSmooth);
    const colThreshold = colMean + colStd * 0.3;

    const segments = findHorizontalBounds(colSmooth, colThreshold);
    for (const seg of segments) {
      const segWidth = seg.xEnd - seg.xStart + 1;
      const aspect = segWidth / band.height;
      if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) continue;
      if (segWidth < 50) continue;

      const aspectScore = 1 - Math.min(1, Math.abs(aspect - ASPECT_IDEAL) / ASPECT_IDEAL);
      const sizeScore = Math.min(1, (segWidth * band.height) / (width * height) * 60);
      const score = aspectScore * 0.65 + sizeScore * 0.35;

      candidates.push({
        rect: { x: seg.xStart, y: band.yStart, width: segWidth, height: band.height },
        aspect,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, MAX_CANDIDATES);

  return top.map((c) => ({
    cropped: cropFromCanvas(canvas, c.rect),
    score: c.score,
    aspect: c.aspect,
    rect: c.rect,
  }));
}

export async function isOpenCVReady() {
  return true;
}
