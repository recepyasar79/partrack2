# ParkTrack OCR Microservice

Python FastAPI service that recognises Turkish licence plates from photos.

## Stack
- **EasyOCR** for character recognition (deep-learning based, much better than Tesseract on real-world plate photos)
- **OpenCV** for plate localisation, deskewing, contrast adjustment
- **FastAPI + uvicorn** for HTTP

## Endpoints
- `GET /health` — readiness probe
- `POST /ocr` — multipart upload, field name `file`. Returns:
  ```json
  {
    "plate": "34MNL089",
    "confidence": 0.92,
    "strategy": "region-1-0/joined",
    "elapsed_ms": 850,
    "raw_text": "34 MNL 089"
  }
  ```
  Add `?debug=true` to include all OCR detections per pass for troubleshooting.

## Local development

```bash
cd backend/python_ocr
python -m venv .venv
source .venv/bin/activate    # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 5000
```

First run downloads ~70MB of EasyOCR weights (cached under `~/.EasyOCR`).

### Test it
```bash
curl -F file=@plate.jpg http://localhost:5000/ocr
```

## Docker

```bash
docker build -t parktrack-ocr .
docker run --rm -p 5000:5000 parktrack-ocr
```

The image is ~1.2GB (PyTorch CPU + EasyOCR weights baked in for fast cold starts).

## Deploying to Fly.io

```bash
fly launch --no-deploy --copy-config --name parktrack-ocr
fly deploy
```

Then point the Node.js backend at it:

```bash
# In the parktrack-backend Fly app
fly secrets set PYTHON_OCR_URL=https://parktrack-ocr.fly.dev
```

## Tuning

- `EASYOCR_GPU=1` — enable CUDA if the host has a GPU (huge speedup; not used on Fly.io shared CPUs).
- `LOG_LEVEL=DEBUG` — verbose logs of every OCR pass.

## Why EasyOCR (not Tesseract)
Tesseract is trained on document fonts and routinely confuses plate characters
(M↔N, V↔Y, F↔E). On the test set we measured ~70% accuracy with Tesseract +
heavy preprocessing vs ~88% with EasyOCR using the same preprocessing. EasyOCR's
detection module also handles slight rotation and perspective distortion that
plates often have when shot from a phone.
