// Plate region detector (Turkish plates: 2-digit city + 1-3 letters + 2-4 digits)
// Uses edge detection + aspect ratio filtering

export async function detectPlateCandidates(file) {
  const img = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const { width: w, height: h } = canvas;
  
  // Turkish plate aspect ratio: ~2.5:1 to 4:1, typical 15-20% of image width
  const minPlateWidth = Math.floor(w * 0.12);
  const maxPlateWidth = Math.floor(w * 0.45);
  const minPlateHeight = Math.floor(h * 0.03);
  const maxPlateHeight = Math.floor(h * 0.12);
  
  // Convert to grayscale
  const imageData = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  const data = imageData.data;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
  }
  
  // Simple edge detection (Sobel-like)
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = gray[idx-1] - gray[idx+1];
      const gy = gray[idx-w] - gray[idx+w];
      edges[idx] = Math.min(255, Math.sqrt(gx*gx + gy*gy));
    }
  }
  
  // Find rectangular regions with high edge density
  const candidates = [];
  const step = 8;
  for (let y = 0; y < h - minPlateHeight; y += step) {
    for (let x = 0; x < w - minPlateWidth; x += step) {
      for (let rh = minPlateHeight; rh <= maxPlateHeight && y + rh < h; rh += step) {
        for (let rw = minPlateWidth; rw <= maxPlateWidth && x + rw < w; rw += step) {
          const aspect = rw / rh;
          if (aspect < 2.0 || aspect > 5.0) continue;
          
          // Sample edge density in this region
          let edgeSum = 0, count = 0;
          for (let dy = 0; dy < rh; dy += 4) {
            for (let dx = 0; dx < rw; dx += 4) {
              edgeSum += edges[(y+dy) * w + (x+dx)] || 0;
              count++;
            }
          }
          const density = edgeSum / (count || 1);
          if (density > 30) {
            candidates.push({
              x, y, width: rw, height: rh,
              score: density / 255,
            });
          }
        }
      }
    }
  }
  
  // Return top candidates (merge overlapping)
  candidates.sort((a, b) => b.score - a.score);
  const result = [];
  for (const c of candidates) {
    const overlap = result.some(r => 
      c.x < r.x + r.width && c.x + c.width > r.x &&
      c.y < r.y + r.height && c.y + c.height > r.y
    );
    if (!overlap && result.length < 5) {
      result.push({
        x: c.x, y: c.y, width: c.width, height: c.height,
        score: c.score,
        cropped: () => {
          const c2 = document.createElement('canvas');
          c2.width = c.width;
          c2.height = c.height;
          c2.getContext('2d').drawImage(canvas, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
          return c2;
        }
      });
    }
  }
  return result;
}

  
  // Basit plaka aralığı (parlak alanlar) — gerçek tespit yapmaz,
  // sadece merkezi bölgeyi döndürür (fallback)
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const w = Math.floor(canvas.width * 0.6);
  const h = Math.floor(canvas.height * 0.2);
  const x0 = Math.max(0, cx - w/2);
  const y0 = Math.max(0, cy - h/2);
  
  return [{
    x: x0,
    y: y0,
    width: w,
    height: h,
    score: 0.5,
    cropped: (() => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      return c;
    })(),
  }];
}
