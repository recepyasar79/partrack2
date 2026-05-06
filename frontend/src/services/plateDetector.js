// Basit plaka bölge tespitçisi (kamera önizlemesinde kullanılır)
// Tesseract.js öncesi plaka bandını kaba taslak belirler.

export async function detectPlateCandidates(file) {
  // Canvas'a çiz, kontrasth hesapla
  const img = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Gri ton ve parlaklık hesapla
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const g = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    pixels.push(g);
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
