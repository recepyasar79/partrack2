// Aggressive multi-method OCR - Tries EVERYTHING to get the correct plate
import Tesseract from 'tesseract.js';

let workerPromise = null;

// All possible Tesseract configs to try
const TESSERACT_CONFIGS = [
  // PSM modes to try (most likely to read full plate)
  { mode: '7', desc: 'Single text line' },
  { mode: '6', desc: 'Single block' },
  { mode: '4', desc: 'Single column' },
  { mode: '3', desc: 'Fully automatic' },
  { mode: '11', desc: 'Sparse text' },
  { mode: '8', desc: 'Single word' },
  { mode: '13', desc: 'Raw line' },
];

// Image preprocessing variants
function applyPreprocessing(canvas, variant) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  
  switch(variant) {
    case 'highContrast':
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
        const v = g < 128 ? 0 : 255;
        d[i] = d[i+1] = d[i+2] = v;
      }
      break;
    case 'invert':
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i];
        d[i+1] = 255 - d[i+1];
        d[i+2] = 255 - d[i+2];
      }
      break;
    case 'boostContrast':
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
        const v = g < 100 ? 0 : (g > 200 ? 255 : g * 1.5);
        d[i] = d[i+1] = d[i+2] = Math.min(255, Math.max(0, v));
      }
      break;
    case 'sharpen':
      // Simple sharpen by increasing contrast
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
        const v = g < 128 ? g * 0.8 : g * 1.2;
        d[i] = d[i+1] = d[i+2] = Math.min(255, Math.max(0, v));
      }
      break;
    default: // original grayscale
      break;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export async function readPlateAggressive(file) {
  const Tesseract = await import('tesseract.js');
  
  // Load image
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  
  const results = [];
  const seen = new Set();
  
  // Try each preprocessing + each PSM config
  const variants = ['original', 'highContrast', 'invert', 'boostContrast', 'sharpen'];
  
  for (const variant of variants) {
    const cvs = document.createElement('canvas');
    cvs.width = canvas.width;
    cvs.height = canvas.height;
    cvs.getContext('2d').drawImage(canvas, 0, 0);
    applyPreprocessing(cvs, variant);
    
    for (const config of TESSERACT_CONFIGS) {
      try {
        const worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          tessedit_pageseg_mode: config.mode,
          preserve_interword_spaces: '0',
        });
        
        const { data: { text } } = await worker.recognize(cvs);
        await worker.terminate();
        
        const cleaned = text.toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (cleaned.length >= 5 && !seen.has(cleaned)) {
          seen.add(cleaned);
          results.push({
            plate: cleaned,
            variant: `${variant}+PSM${config.mode}`,
          });
        }
      } catch (e) {
        console.warn(`OCR failed (${variant}+PSM${config.mode}):`, e.message);
      }
    }
  }
  
  // Also try: resize image bigger (sometimes helps with small text)
  const bigCanvas = document.createElement('canvas');
  bigCanvas.width = canvas.width * 2;
  bigCanvas.height = canvas.height * 2;
  const bigCtx = bigCanvas.getContext('2d');
  bigCtx.imageSmoothingEnabled = true;
  bigCtx.drawImage(canvas, 0, 0, bigCanvas.width, bigCanvas.height);
  
  for (const config of TESSERACT_CONFIGS) {
    try {
      const worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        tessedit_pageseg_mode: config.mode,
        preserve_interword_spaces: '0',
      });
      
      const { data: { text } } = await worker.recognize(bigCanvas);
      await worker.terminate();
      
      const cleaned = text.toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (cleaned.length >= 5 && !seen.has(cleaned)) {
        seen.add(cleaned);
        results.push({
          plate: cleaned,
          variant: `big+PSM${config.mode}`,
        });
      }
    } catch (e) {
      console.warn(`OCR failed (big+PSM${config.mode}):`, e.message);
    }
  }
  
  console.log('All OCR attempts:', results);
  
  // Now try to find best match using plateMatcher (if available)
  // For now, return all results sorted by length (longer plates are more likely correct)
  results.sort((a, b) => b.plate.length - a.plate.length);
  
  return results;
}

// Export a function that tries 10 times and returns best result
export async function readPlateMultiAttempt(file, maxAttempts = 10) {
  const allResults = await readPlateAggressive(file);
  
  if (allResults.length === 0) return null;
  
  // Group by similar plates (Levenshtein distance)
  const groups = [];
  for (const result of allResults) {
    let found = false;
    for (const group of groups) {
      // If similar to existing group, add to it
      const dist = levenshteinDistance(result.plate, group[0].plate);
      if (dist <= 2) {
        group.push(result);
        found = true;
        break;
      }
    }
    if (!found) groups.push([result]);
  }
  
  // Return the most common plate (or longest)
  groups.sort((a, b) => b.length - a.length);
  const bestGroup = groups[0];
  bestGroup.sort((a, b) => b.plate.length - a.plate.length);
  
  return bestGroup[0].plate;
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) === a.charAt(j-1)) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1,
          matrix[i][j-1] + 1,
          matrix[i-1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
