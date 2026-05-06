// Plate region detector - inspired by Python OpenCV approach
// Uses: grayscale → bilateral filter → Canny → contours → plate detection

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

    // 1. Convert to grayscale
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }

    // 2. Bilateral filter (approximate with Gaussian + edge preservation)
    const filtered = bilateralFilter(gray, w, h, 13, 15, 15);

    // 3. Canny edge detection
    const edges = cannyEdge(filtered, w, h, 30, 200);

    // 4. Find contours using connected components
    const contours = findContours(edges, w, h);

    // 5. Approximate contours to polygons, find rectangular ones
    const candidates = [];
    const minPlateArea = w * h * 0.001;  // At least 0.1% of image
    const maxPlateArea = w * h * 0.05;   // At most 5% of image

    for (const contour of contours) {
      if (contour.length < 4) continue;

      // Approximate polygon with Douglas-Peucker
      const approx = approxPolyDP(contour, 0.018 * perimeter(contour));

      // Check if it's rectangular (4 points) and roughly plate-sized
      if (approx.length === 4) {
        const area = contourArea(approx);
        if (area < minPlateArea || area > maxPlateArea) continue;

        // Check aspect ratio (Turkish plates: 2.5:1 to 5:1)
        const { x, y, width, height } = boundingBox(approx);
        const aspect = width / height;
        if (aspect < 2.0 || aspect > 5.0) continue;

        // Check if it's roughly horizontal
        const angle = Math.abs(Math.atan2(height, width)) * 180 / Math.PI;
        if (angle > 30 && angle < 150) continue;

        candidates.push({
          x, y, width, height,
          score: area / (w * h) * 100,
          cropped: function() {
            const c2 = document.createElement('canvas');
            c2.width = width;
            c2.height = height;
            c2.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
            return c2;
          }
        });
      }
    }

    // Sort by score (area percentage) and return top candidates
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 5);

  } catch (e) {
    console.warn('Plate detection failed:', e);
    return [];
  }
}

// Bilateral filter approximation (noise reduction while preserving edges)
function bilateralFilter(gray, w, h, d, sigmaColor, sigmaSpace) {
  const output = new Uint8Array(w * h);
  const gc = Math.round(sigmaColor);
  const gs = Math.round(sigmaSpace);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const centerIdx = y * w + x;
      let sum = 0, weightSum = 0;

      for (let dy = -gs; dy <= gs; dy++) {
        for (let dx = -gs; dx <= gs; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

          const neighborIdx = ny * w + nx;
          const colorDiff = Math.abs(gray[centerIdx] - gray[neighborIdx]);
          const spatialDist = dx * dx + dy * dy;

          const weight = Math.exp(-(colorDiff * colorDiff) / (2 * gc * gc))
                      * Math.exp(-spatialDist / (2 * gs * gs));

          sum += gray[neighborIdx] * weight;
          weightSum += weight;
        }
      }

      output[centerIdx] = weightSum > 0 ? Math.round(sum / weightSum) : gray[centerIdx];
    }
  }
  return output;
}

// Canny edge detection
function cannyEdge(gray, w, h, lowThresh, highThresh) {
  // Step 1: Sobel gradients
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      gx[idx] = gray[idx - 1] - gray[idx + 1];
      gy[idx] = gray[idx - w] - gray[idx + w];
      mag[idx] = Math.sqrt(gx[idx] * gx[idx] + gy[idx] * gy[idx]);
    }
  }

  // Step 2: Non-maximum suppression
  const suppressed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const angle = Math.atan2(gy[idx], gx[idx]) * 180 / Math.PI;
      const dir = Math.round((angle + 180) / 45) % 4;

      let isMax = true;
      if (dir === 0) { // 0°: horizontal
        isMax = mag[idx] >= (mag[idx - 1] || 0) && mag[idx] >= (mag[idx + 1] || 0);
      } else if (dir === 1) { // 45°: diagonal
        isMax = mag[idx] >= (mag[idx - w - 1] || 0) && mag[idx] >= (mag[idx + w + 1] || 0);
      } else if (dir === 2) { // 90°: vertical
        isMax = mag[idx] >= (mag[idx - w] || 0) && mag[idx] >= (mag[idx + w] || 0);
      } else { // 135°: diagonal
        isMax = mag[idx] >= (mag[idx - w + 1] || 0) && mag[idx] >= (mag[idx + w - 1] || 0);
      }

      if (isMax && mag[idx] >= lowThresh) {
        suppressed[idx] = mag[idx];
      }
    }
  }

  // Step 3: Hysteresis thresholding
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (suppressed[idx] >= highThresh) {
        edges[idx] = 255;
        // Weak edges connected to strong edges
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = (y + dy) * w + (x + dx);
            if (suppressed[nIdx] >= lowThresh) edges[nIdx] = 255;
          }
        }
      }
    }
  }
  return edges;
}

// Find contours using connected components (simplified)
function findContours(edges, w, h) {
  const visited = new Uint8Array(w * h);
  const contours = [];

  function floodFill(x, y) {
    const stack = [[x, y]];
    const points = [];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const idx = cy * w + cx;
      if (cx < 0 || cx >= w || cy < 0 || cy >= h || visited[idx] || edges[idx] === 0) continue;
      visited[idx] = 1;
      points.push([cx, cy]);

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return points;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (edges[idx] > 0 && !visited[idx]) {
        const contour = floodFill(x, y);
        if (contour.length > 10) { // Ignore tiny contours
          contours.push(contour);
        }
      }
    }
  }
  return contours;
}

// Approximate polygon using Douglas-Peucker algorithm
function approxPolyDP(contour, epsilon) {
  if (contour.length <= epsilon) return contour;

  function douglasPeucker(contour, start, end, epsilon) {
    let maxDist = 0, maxIdx = start;
    const startPt = contour[start];
    const endPt = contour[end];

    for (let i = start + 1; i < end; i++) {
      const dist = pointToLineDistance(contour[i], startPt, endPt);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = douglasPeucker(contour, start, maxIdx, epsilon);
      const right = douglasPeucker(contour, maxIdx, end, epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [startPt, endPt];
  }

  return douglasPeucker(contour, 0, contour.length - 1, epsilon);
}

function pointToLineDistance(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);

  let t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  return Math.hypot(point[0] - projX, point[1] - projY);
}

function perimeter(contour) {
  let sum = 0;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    sum += Math.hypot(contour[i][0] - contour[j][0], contour[i][1] - contour[j][1]);
  }
  return sum;
}

function contourArea(contour) {
  let area = 0;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    area += contour[j][0] * contour[i][1] - contour[i][0] * contour[j][1];
  }
  return Math.abs(area) / 2;
}

function boundingBox(contour) {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const [x, y] of contour) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
