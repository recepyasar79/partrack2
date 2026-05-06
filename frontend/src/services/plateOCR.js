/**
 * Gelişmiş Plaka OCR Servisi
 * Tesseract.js ile Türk plaka tanıma - iyileştirilmiş karakter düzeltme
 */

let workerPromise = null;

const PLATE_WHITELIST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Türk plaka formatları:
//   2 rakam + 1 harf + 4 rakam      → 34A1234
//   2 rakam + 2 harf + 2-4 rakam    → 34AB12, 34AB1234
//   2 rakam + 3 harf + 2-3 rakam    → 34ABC12, 34ABC123
const PLATE_BODY_SRC = '\\d{2}(?:[A-Z]\\d{4}|[A-Z]{2}\\d{2,4}|[A-Z]{3}\\d{2,3})';
const PLATE_BODY_EXACT = new RegExp(`^${PLATE_BODY_SRC}$`);

// Diplomatik format (basit): CC/CD + 3-6 rakam (ör: CC12345)
const DIPLO_PLATE_EXACT = /^(?:CC|CD)\d{3,6}$/;

const TR_CITY_CODES = new Set();
for (let i = 1; i <= 81; i++) TR_CITY_CODES.add(String(i).padStart(2, '0'));

// ============================================================================
// KARAKTER DÜZELTME TABLOLARI
// ============================================================================

// OCR genellikle bu karakterleri karıştırır:
// Harfler: Y↔K, D↔O, M↔N, R↔P, U↔V, C↔G, S↔5, Z↔2, I↔1, O↔0
// Rakamlar: 0↔O, 1↔I, 2↔Z, 4↔A, 5↔S, 6↔G, 8↔B, 9↔g

// Yaygın OCR hataları - OCR'ın okuduğu → Doğru karakter
const CHAR_SUBSTITUTIONS = {
  // OCR Y yerine K okuyor (34YF9876 → 34KF957)
  'K': 'Y',
  // OCR W yerine D veya M okuyor (34DML77 → 43WW42)
  'W': null, // Özel işlem gerekli
  // OCR 4 yerine 9 okuyor
  '9': '4',
  // OCR 7 yerine 2 okuyor
  '2': '7',
  // OCR 5 yerine 8 okuyor
  '8': '5',
  // OCR 6 yerine G okuyor
  'G': '6',
  // OCR S yerine 5 okuyor
  'S': '5',
  // OCR Z yerine 2 okuyor
  'Z': '2',
  // OCR A yerine 4 okuyor
  'A': '4',
  // OCR B yerine 8 okuyor
  'B': '8',
  // OCR I yerine 1 okuyor
  'I': '1',
  // OCR O yerine 0 okuyor
  'O': '0',
  // OCR P yerine R okuyor
  'P': 'R',
  // OCR N yerine M okuyor
  'N': 'M',
  // OCR V yerine U okuyor
  'V': 'U',
  // OCR C yerine G okuyor
  'C': 'G',
};

// Tersine çevrilmiş tablo: Doğru → OCR'un okuyabileceği
const REVERSE_SUBSTITUTIONS = {};
for (const [ocr, correct] of Object.entries(CHAR_SUBSTITUTIONS)) {
  if (correct && correct !== null) {
    if (!REVERSE_SUBSTITUTIONS[correct]) REVERSE_SUBSTITUTIONS[correct] = [];
    if (!REVERSE_SUBSTITUTIONS[correct].includes(ocr)) {
      REVERSE_SUBSTITUTIONS[correct].push(ocr);
    }
  }
}

// ============================================================================
// KARAKTER DÜZELTME FONKSİYONLARI
// ============================================================================

/**
 * OCR çıktısındaki karakterleri pozisyon bazlı düzeltir
 * Türk plakalarında belirli pozisyonlardaki karakterler daha sık karışıyor
 */
function fixPlateChars(s) {
  if (!s || s.length < 5) return s;
  const chars = s.split('');

  // Pozisyon 0-1: Şehir kodu (rakam) - 4 ve 3 sıklıkla karışıyor
  if (chars[0] === '4' && chars[1] === '3') {
    chars[0] = '3';
    chars[1] = '4';
  }

  // Pozisyon 2: Harf bölgesi ilk harf - Y↔K karışıklığı çok yaygın
  if (chars[2] === 'K') chars[2] = 'Y';
  if (chars[2] === 'W') chars[2] = 'D'; // W genellikle D olarak okunur

  // Pozisyon 3: Harf bölgesi ikinci harf
  if (chars[3] === 'W') chars[3] = 'M'; // W genellikle M olarak okunur
  if (chars[3] === '5') chars[3] = 'R'; // 5-R karışıklığı
  if (chars[3] === '4') chars[3] = 'A'; // 4-A karışıklığı
  if (chars[3] === 'N') chars[3] = 'M'; // N-M karışıklığı
  if (chars[3] === 'U') chars[3] = 'V'; // U-V karışıklığı

  // Pozisyon 4: Üçüncü harf (varsa)
  if (chars.length > 4) {
    if (chars[4] === '4') chars[4] = 'A';
    if (chars[4] === '5') chars[4] = 'S';
    if (chars[4] === 'I') chars[4] = '1';
  }

  // Pozisyon 5+: Rakam bölgesi - 9↔4, 7↔2, 5↔8 en yaygın karışıklıklar
  for (let i = 5; i < chars.length; i++) {
    if (chars[i] === '9') chars[i] = '4';  // 9 → 4
    if (chars[i] === '4') chars[i] = '9';  // 4 → 9
    if (chars[i] === '2') chars[i] = '7';  // 2 → 7
    if (chars[i] === '7') chars[i] = '2';  // 7 → 2
    if (chars[i] === '5') chars[i] = '8';  // 5 → 8
    if (chars[i] === '8') chars[i] = '5';  // 8 → 5
    if (chars[i] === '6') chars[i] = 'G';  // 6 → G
    if (chars[i] === 'G') chars[i] = '6';  // G → 6
    if (chars[i] === 'S') chars[i] = '5';  // S → 5
    if (chars[i] === 'Z') chars[i] = '2';  // Z → 2
    if (chars[i] === '0') chars[i] = 'O';  // 0 → O
    if (chars[i] === 'O') chars[i] = '0';  // O → 0
  }

  return chars.join('');
}

/**
 * Genel karakter düzeltme - pozisyondan bağımsız
 */
function applyGeneralCharFix(s) {
  if (!s) return s;
  let result = s;
  for (const [ocrChar, correctChar] of Object.entries(CHAR_SUBSTITUTIONS)) {
    if (correctChar === null) continue;
    result = result.split(ocrChar).join(correctChar);
  }
  return result;
}

/**
 * Levenshtein mesafesi hesapla (karakter düzeltmeleri için)
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * OCR çıktısından geçerli Türk plakası oluştur
 * Çoklu düzeltme denemesi yapar
 */
function normalizeOCRGuess(ocrOutput) {
  if (!ocrOutput || ocrOutput.length < 5) return null;

  const variants = new Set();

  // 1. Orijinal
  variants.add(ocrOutput);

  // 2. Pozisyon bazlı düzeltme
  variants.add(fixPlateChars(ocrOutput));

  // 3. Genel karakter düzeltmesi
  variants.add(applyGeneralCharFix(ocrOutput));

  // 4. Kombinasyonlu düzeltme
  variants.add(applyGeneralCharFix(fixPlateChars(ocrOutput)));
  variants.add(fixPlateChars(applyGeneralCharFix(ocrOutput)));

  // 5. Tüm şehir kodu takasları (4↔3 için)
  let swapped = ocrOutput;
  if (ocrOutput[0] === '4' && ocrOutput[1] === '3') {
    swapped = '3' + '4' + ocrOutput.slice(2);
    variants.add(swapped);
    variants.add(fixPlateChars(swapped));
    variants.add(applyGeneralCharFix(swapped));
  } else if (ocrOutput[0] === '3' && ocrOutput[1] === '4') {
    swapped = '4' + '3' + ocrOutput.slice(2);
    variants.add(swapped);
    variants.add(fixPlateChars(swapped));
  }

  // Geçerli plakaları filtrele
  const validPlates = [];
  for (const variant of variants) {
    if (!variant) continue;
    const cleaned = variant.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (DIPLO_PLATE_EXACT.test(cleaned)) {
      validPlates.push(cleaned);
      continue;
    }
    if (PLATE_BODY_EXACT.test(cleaned) && TR_CITY_CODES.has(cleaned.slice(0, 2))) {
      validPlates.push(cleaned);
    }
  }

  if (validPlates.length > 0) {
    // En az değişiklik gerektiren varyantı seç; eşitse daha uzunu tercih et.
    const base = String(ocrOutput).toUpperCase().replace(/[^0-9A-Z]/g, '');
    validPlates.sort((a, b) => {
      const da = levenshteinDistance(a, base);
      const db = levenshteinDistance(b, base);
      if (da !== db) return da - db; // daha yakın olan
      if (b.length !== a.length) return b.length - a.length; // daha uzun olan
      return a.localeCompare(b);
    });
    return validPlates[0];
  }

  return null;
}

// ============================================================================
// KANVAS VE GÖRÜNTÜ İŞLEME
// ============================================================================

async function bitmapFromFile(file) {
  return await createImageBitmap(file);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function makeScaledCanvas(file, targetMaxDim) {
  const bitmap = await bitmapFromFile(file);
  const scale = Math.min(targetMaxDim / Math.max(bitmap.width, bitmap.height), 4);
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

/**
 * Yüksek kontrast uygula
 */
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

/**
 * Adaptif eşikleme uygula (OCR için optimize)
 */
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
        integral[(y2 + 1) * (w + 1) + (x2 +1)] -
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

/**
 * Parlaklık ve kontrast ayarla
 */
function adjustBrightnessContrast(canvas, brightness = 10, contrast = 1.3) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let val = d[i + c];
      val = val + brightness;
      val = ((val - 128) * contrast) + 128;
      d[i + c] = Math.max(0, Math.min(255, val));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * invert (siyah yazı, beyaz arka plan)
 */
function invertColors(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ============================================================================
// OCR ÇEKİRDEK
// ============================================================================

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist: PLATE_WHITELIST,
        tessedit_pageseg_mode: '7',  // Single text line (plates are one line!)
        preserve_interword_spaces: '0',
      });
      return worker;
    })();
  }
  return workerPromise;
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

function tokensFromWords(words) {
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
    // Plakada aynı satır içinde küçük dikey kaymalar olabiliyor (özellikle son rakam).
    // Çok agresif ayırmak (0.6) son haneyi yanlışlıkla alt satıra atabiliyor.
    const threshold = Math.max(rowH, w.h) * 0.9;
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

function collectFromCleaned(cleaned, numLines, candidates, source) {
  if (!cleaned || cleaned.length < 5) return;

  // Tüm alt stringleri dene
  for (let len = Math.min(12, cleaned.length); len >= 5; len--) {
    for (let i = 0; i + len <= cleaned.length; i++) {
      const sub = cleaned.slice(i, i + len);
      const isDiplo = sub.startsWith('CC') || sub.startsWith('CD');
      if (!isDiplo && !TR_CITY_CODES.has(sub.slice(0, 2))) continue;

      // Düzeltilmiş versiyonları dene
      const normalized = normalizeOCRGuess(sub);
      if (normalized && (PLATE_BODY_EXACT.test(normalized) || DIPLO_PLATE_EXACT.test(normalized))) {
        candidates.push({
          plate: normalized,
          length: normalized.length,
          kind: 'normalized',
          extraChars: cleaned.length - normalized.length,
          numLines,
          source,
          original: sub,
        });
      }

      // Orijinal versiyonu da dene
      if (
        DIPLO_PLATE_EXACT.test(sub) ||
        (PLATE_BODY_EXACT.test(sub) && TR_CITY_CODES.has(sub.slice(0, 2)))
      ) {
        candidates.push({
          plate: sub,
          length: sub.length,
          kind: 'direct',
          extraChars: cleaned.length - sub.length,
          numLines,
          source,
          original: sub,
        });
      }
    }
  }
}

export function extractPlate(rawText, words = null) {
  if (!rawText && (!words || words.length === 0)) return { guess: '', matched: false };
  const candidates = [];

  // Görsel satırlardan (bbox bazlı) dene
  const visualRows = rowsFromWords(words);
  for (const row of visualRows) {
    collectFromCleaned(row, 1, candidates, 'visual');
  }

  // Metin satırlarından dene
  const lines = (rawText || '').split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  const cleanedLines = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean);

  for (const cleaned of cleanedLines) {
    collectFromCleaned(cleaned, 1, candidates, 'text');
  }

  // Heuristic: bazı OCR modlarında son rakam ayrı satıra düşebiliyor.
  // 1 harfli (34A1234) ve 2 harfli (34AB1234) plakalar 4 haneli rakam ile bitebildiği için,
  // ilk satır "eksik 1 rakam" gibi görünüyorsa ve takip eden satır tek rakamsa birleştir.
  const oneLetterNeeds4 = /^\d{2}[A-Z]\d{3}$/;
  const twoLetterNeeds4 = /^\d{2}[A-Z]{2}\d{3}$/;
  const singleDigit = /^\d$/;

  function digitAlternatives(d) {
    // Son hane için çok sınırlı alternatif denemesi (yaygın OCR karışıklıkları).
    if (d === '7') return ['7', '6'];
    if (d === '6') return ['6', '7'];
    if (d === '8') return ['8', '6'];
    if (d === '0') return ['0'];
    return [d];
  }

  // Not: OCR çıktısı çok gürültülü olabiliyor; son rakam her zaman hemen bir sonraki satırda olmayabiliyor.
  // Bu yüzden plaka satırından sonra kısa bir pencerede (3 satır) tek rakam arıyoruz.
  for (let i = 0; i < cleanedLines.length; i++) {
    const a = cleanedLines[i];
    if (!a) continue;
    if (!oneLetterNeeds4.test(a) && !twoLetterNeeds4.test(a)) continue;
    if (!TR_CITY_CODES.has(a.slice(0, 2))) continue;

    const lookahead = 3;
    for (let j = i + 1; j <= Math.min(cleanedLines.length - 1, i + lookahead); j++) {
      const b = cleanedLines[j];
      if (!b) continue;

      // Pencerede başka bir geçerli plaka gövdesi görürsek bu "son rakam" değildir → vazgeç.
      if (PLATE_BODY_EXACT.test(b) || DIPLO_PLATE_EXACT.test(b)) break;

      if (!singleDigit.test(b)) continue;

      for (const d of digitAlternatives(b)) {
        const joined = a + d;
        if (PLATE_BODY_EXACT.test(joined)) {
          candidates.push({
            plate: joined,
            length: joined.length,
            kind: 'joined-tail-digit',
            extraChars: 0,
            // Aynı plaka iki satıra bölündü gibi davran.
            numLines: 1,
            source: 'tail-digit',
            original: `${a}\\n...\\n${b}`,
          });
        }
      }
    }
  }

  // Satırları birleştirerek dene
  for (let start = 0; start < cleanedLines.length; start++) {
    let joined = cleanedLines[start];
    for (let end = start + 1; end < cleanedLines.length; end++) {
      joined += cleanedLines[end];
      if (joined.length > 14) break;
      const numLines = end - start + 1;

      const normalized = normalizeOCRGuess(joined);
      if (normalized && PLATE_BODY_EXACT.test(normalized)) {
        candidates.push({
          plate: normalized,
          length: normalized.length,
          kind: 'joined-normalized',
          extraChars: 0,
          numLines,
          source: 'joined',
          original: joined,
        });
      }

      if (PLATE_BODY_EXACT.test(joined)) {
        candidates.push({
          plate: joined,
          length: joined.length,
          kind: 'joined-direct',
          extraChars: 0,
          numLines,
          source: 'joined',
          original: joined,
        });
      }
    }
  }

  if (candidates.length > 0) {
    const sourceRank = { visual: 0, text: 1, joined: 2 };
    candidates.sort((a, b) => {
      // Tail-digit join özel durumu: "34YF987" + "\n6" => "34YF9876"
      // Eğer daha uzun aday, daha kısanın sonuna tek rakam eklenmiş haliyse onu tercih et.
      if (a.kind === 'joined-tail-digit' && b.plate && a.plate && a.plate.slice(0, -1) === b.plate) return -1;
      if (b.kind === 'joined-tail-digit' && a.plate && b.plate && b.plate.slice(0, -1) === a.plate) return 1;

      // Ekstra karakter yoksa tercih et
      if (a.extraChars === 0 && b.extraChars > 0) return -1;
      if (a.extraChars > 0 && b.extraChars === 0) return 1;

      // Kaynak önceliği
      const sa = sourceRank[a.source] ?? (a.source === 'tail-digit' ? sourceRank.text : 9);
      const sb = sourceRank[b.source] ?? (b.source === 'tail-digit' ? sourceRank.text : 9);
      if (sa !== sb) return sa - sb;

      // Daha az satır birleşimi tercih et
      const an = a.numLines || 1;
      const bn = b.numLines || 1;
      if (an !== bn) return an - bn;

      // Uzunluk tercihi
      if (b.length !== a.length) return b.length - a.length;

      // Aynı uzunlukta ise normalize edilmiş olanı tercih et
      if (a.kind === 'normalized' && b.kind !== 'normalized') return -1;
      if (b.kind === 'normalized' && a.kind !== 'normalized') return 1;

      // Tür önceliği
      const order = { direct: 0, normalized: 1, 'joined-tail-digit': 2, 'joined-direct': 3, 'joined-normalized': 4 };
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
    });

    return {
      guess: candidates[0].plate,
      original: candidates[0].original,
      matched: true,
      candidates: candidates.slice(0, 5)
    };
  }

  // Hiçbir şey bulamadıysa en azından düzeltilmiş versiyonu döndür
  const fallback = normalizeOCRGuess(cleanedLines.join('').slice(0, 16)) || cleanedLines.join('').slice(0, 16);
  return { guess: fallback, original: rawText, matched: false };
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

// ============================================================================
// PLAKA DETECTÖRÜ
// ============================================================================

async function tryDetectionPipeline(file, onProgress) {
  let detector;
  try {
    onProgress?.('Plaka detector hazırlanıyor');
    detector = await import('./plateDetector');
  } catch {
    return null;
  }
  try {
    onProgress?.('Plaka adayları aranıyor');
    const candidates = await detector.detectPlateCandidates(file);
    onProgress?.(`${candidates?.length || 0} aday bulundu`);
    if (!candidates || candidates.length === 0) return null;

    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      onProgress?.(`Aday ${i + 1}/${candidates.length} işleniyor`);
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

// ============================================================================
// GÖRÜNTÜ VARYANTLARI
// ============================================================================

async function buildVariants(file, onProgress) {
  const variants = [];

  // Orijinal - büyük boyut
  onProgress?.('Orijinal görüntü hazırlanıyor');
  const original = await makeScaledCanvas(file, 1800);
  variants.push({ name: 'original', image: original });

  // Yüksek kontrast varyantları
  onProgress?.('Yüksek kontrast varyantı hazırlanıyor');
  const hc1 = await makeScaledCanvas(file, 1800);
  applyHighContrast(hc1);
  variants.push({ name: 'high-contrast', image: hc1 });

  onProgress?.('Güçlü yüksek kontrast hazırlanıyor');
  const hc2 = await makeScaledCanvas(file, 1800);
  applyHighContrast(hc2, 140, 50, 70);
  variants.push({ name: 'strong-hc', image: hc2 });

  // Adaptif eşikleme
  onProgress?.('Adaptif eşikleme varyantı hazırlanıyor');
  const adapt1 = await makeScaledCanvas(file, 1800);
  applyAdaptiveThreshold(adapt1, 31, 12);
  variants.push({ name: 'adaptive', image: adapt1 });

  onProgress?.('Adaptif eşikleme (küçük blok) hazırlanıyor');
  const adapt2 = await makeScaledCanvas(file, 1800);
  applyAdaptiveThreshold(adapt2, 15, 8);
  variants.push({ name: 'adaptive-small', image: adapt2 });

  // Parlaklık/kontrast varyantları
  onProgress?.('Parlaklık/kontrast varyantı hazırlanıyor');
  const bc1 = await makeScaledCanvas(file, 1800);
  adjustBrightnessContrast(bc1, 15, 1.4);
  variants.push({ name: 'bright-contrast', image: bc1 });

  // Büyütülmüş varyantlar
  onProgress?.('2x büyütülmüş varyant hazırlanıyor');
  const big1 = await makeScaledCanvas(file, 2600);
  applyHighContrast(big1, 140, 35, 50);
  variants.push({ name: 'large-hc', image: big1 });

  onProgress?.('2.5x büyütülmüş varyant hazırlanıyor');
  const big2 = await makeScaledCanvas(file, 3200);
  applyHighContrast(big2, 135, 40, 55);
  variants.push({ name: 'xlarge-hc', image: big2 });

  // İnvert (negatif) varyant - bazı durumlarda işe yarar
  onProgress?.('İnvert varyant hazırlanıyor');
  const inv = await makeScaledCanvas(file, 1800);
  invertColors(inv);
  variants.push({ name: 'inverted', image: inv });

  return variants;
}

// ============================================================================
// ANA FONKSİYON
// ============================================================================

export async function recognizePlate(file, options = {}) {
  const { onProgress, usePlateDetector = true } = options;

  // Önce plaka detector dene
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
  if (detected?.matched) {
    onProgress?.('Plaka detector ile bulundu');
    return detected;
  }

  // Fallback: Görüntü varyantları
  let best = detected;
  let bestVariants = [];
  const variants = await buildVariants(file, onProgress);

  // PSM modları - plaka okuma için en iyileri
  const psmModes = ['7', '11', '6', '12', '13'];

  for (const variant of variants) {
    for (const psm of psmModes) {
      onProgress?.(`OCR: ${variant.name} / PSM ${psm}`);
      try {
        const r = await ocrImage(variant.image, psm);
        r.source = 'fallback';
        r.variant = variant.name;

        if (r.matched) {
// Bulunan ilk eşleşmeyi hemen döndür
          onProgress?.(`Eşleşme bulundu: ${r.guess} (${variant.name})`);
          return r;
        }

        // En iyi sonuçları sakla
        if (!best || r.confidence > (best.confidence || 0)) {
          best = r;
          bestVariants = [{ ...r, variant: variant.name, psm }];
        } else if (r.confidence === best.confidence) {
          bestVariants.push({ ...r, variant: variant.name, psm });
        }
      } catch (err) {
        if (!best) best = { raw: '', guess: '', confidence: 0, error: err.message, source: 'fallback', variant: variant.name };
      }
    }
  }

  // Hiç eşleşme yoksa en iyi tahmini döndür
  if (best && best.guess) {
    // Son bir düzeltme denemesi
    const normalized = normalizeOCRGuess(best.guess);
    if (normalized && normalized !== best.guess) {
      return { ...best, guess: normalized, original: best.guess, wasNormalized: true };
    }
  }

  return best || { raw: '', guess: '', confidence: 0 };
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
