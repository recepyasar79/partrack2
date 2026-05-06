// Plate region detector (Turkish plates: 2-digit city + 1-3 letters + 2-4 digits)
// Uses edge detection + aspect ratio filtering

export async function detectPlateCandidates(file) {
  try {
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const w = canvas.width;
    const h = canvas.height;
    
    // Turkish plate: ~2.5:1 to 4:1 aspect, 15-20% of image width
    const minPlateWidth = Math.floor(w * 0.12);
    const maxPlateWidth = Math.floor(w * 0.45);
    const minPlateHeight = Math.floor(h * 0.03);
    const maxPlateHeight = Math.floor(h * 0.12);
    
    // Convert to grayscale
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const gray = new Uint8Array(w * h);
    
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    }
    
    // Simple edge detection
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
            
            // Sample edge density
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
                x: x,
                y: y,
                width: rw,
                height: rh,
                score: density / 255,
                cropped: function() {
                  const c2 = document.createElement('canvas');
                  c2.width = rw;
                  c2.height = rh;
                  c2.getContext('2d').drawImage(canvas, x, y, rw, rh, 0, 0, rw, rh);
                  return c2;
                }
              });
            }
          }
        }
      }
    }
    
    // Return top candidates (merge overlapping)
    candidates.sort(function(a, b) { return b.score - a.score; });
    const result = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const overlap = result.some(function(r) {
        return c.x < r.x + r.width && c.x + c.width > r.x &&
               c.y < r.y + r.height && c.y + c.height > r.y;
      });
      if (!overlap && result.length < 5) {
        result.push(c);
      }
    }
    return result;
    
  } catch(e) {
    return [];
  }
}
