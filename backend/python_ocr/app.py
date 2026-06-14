"""
ParkTrack Python OCR Microservice
- EasyOCR for character recognition (much better than Tesseract for plates)
- OpenCV for plate localization with multiple strategies
- FastAPI for HTTP layer
"""
import asyncio
import io
import logging
import os
import re
import time
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import easyocr

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("plate_ocr")

# ---------------------------------------------------------------------------
# OCR engine
# ---------------------------------------------------------------------------
# EasyOCR loads weights on first use; warming it up at startup avoids the cold
# start on the first request.
USE_GPU = os.environ.get("EASYOCR_GPU", "0") == "1"
log.info("Initialising EasyOCR (gpu=%s)…", USE_GPU)
_reader = easyocr.Reader(["en"], gpu=USE_GPU, verbose=False)
log.info("EasyOCR ready.")

# ---------------------------------------------------------------------------
# Plate detector (PaddleOCR, optional)
# ---------------------------------------------------------------------------
# PaddleOCR PP-OCRv4_mobile_det — Apache 2.0 lisanslı; ticari kapalı kaynak
# SaaS'a uygun. YOLOv8 (AGPL-3.0) yerine bu kullanılıyor — YOLOv8 lisansı
# tüm projeyi public açmaya zorluyordu.
#
# Sobel-based fallback (detect_plate_regions) korunuyor: PaddleOCR yüklenemezse
# veya PADDLE_DETECTION=0 ile kapatılırsa otomatik o yola düşer.
PADDLE_ENABLED = os.environ.get("PADDLE_DETECTION", "1") == "1"
_paddle_detector = None
_paddle_load_error = None


def _load_paddle():
    """Lazy-init PaddleOCR'ın yalnız detection modülü.
    Recognition için EasyOCR'ı tutuyoruz — Paddle recognition'a geçiş ayrı bir
    iş. Hata olursa Sobel fallback'i devreye girer; service yine ayakta kalır.
    """
    global _paddle_detector, _paddle_load_error
    if _paddle_detector is not None or _paddle_load_error is not None:
        return _paddle_detector
    if not PADDLE_ENABLED:
        _paddle_load_error = "PADDLE_DETECTION=0"
        return None
    try:
        from paddleocr import TextDetection  # type: ignore
        model_name = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv4_mobile_det")
        log.info("PaddleOCR detector yükleniyor: %s", model_name)
        _paddle_detector = TextDetection(model_name=model_name)
        log.info("PaddleOCR detector hazır.")
    except Exception as exc:
        _paddle_load_error = str(exc)
        log.warning("PaddleOCR yüklenemedi (%s) — Sobel fallback kullanılacak.", exc)
    return _paddle_detector


# Startup'ta yüklemeyi tetikle ki ilk fotograf cold-start cezası ödemesin.
_load_paddle()

# ---------------------------------------------------------------------------
# Turkish plate validation
# ---------------------------------------------------------------------------
TR_CITY_CODES = {f"{i:02d}" for i in range(1, 82)}

# Standard plate body:
#   2 digits + 1 letter  + 4 digits   (34A1234)
#   2 digits + 2 letters + 2-4 digits (34AB12, 34AB1234)
#   2 digits + 3 letters + 2-3 digits (34ABC12, 34ABC123)
PLATE_BODY = re.compile(
    r"^\d{2}(?:[A-Z]\d{4}|[A-Z]{2}\d{2,4}|[A-Z]{3}\d{2,3})$"
)
DIPLO_PLATE = re.compile(r"^(?:CC|CD)\d{3,6}$")
# Diplomatik plakalar (CC/CD) konut sitelerinde pratikte hiç görülmez ama
# "CD"/"CC" + rakam, standart bir plakanın çok yaygın yanlış-okumasıdır
# (saha: 34COZ143 → CD21434). char_variants'ın O→D swap'iyle birleşince OCR
# sağlam bir standart plakayı sahte bir diplomatik plakaya çeviriyor ve matcher
# bunu düzeltemiyor (iki string arasında ortak karakter yok). Bu yüzden DIPLO
# kabulü varsayılan KAPALI; gerçekten diplomatik plaka beklenen bir kurulumda
# OCR_ALLOW_DIPLOMATIC=1 ile açılabilir.
ALLOW_DIPLOMATIC = os.environ.get("OCR_ALLOW_DIPLOMATIC", "0") == "1"

# Common OCR confusions on plate fonts. We try both directions because
# EasyOCR sometimes reads them either way depending on lighting.
CHAR_FIXES = {
    "0": ["0", "O", "Q", "D"],
    "O": ["O", "0", "Q", "D"],
    "1": ["1", "I", "L", "T"],
    "I": ["I", "1", "L", "T"],
    "L": ["L", "1", "I"],
    "2": ["2", "Z"],
    "Z": ["Z", "2"],
    "5": ["5", "S"],
    "S": ["S", "5"],
    "8": ["8", "B"],
    "B": ["B", "8"],
    "6": ["6", "G"],
    "G": ["G", "6"],
    "7": ["7", "T"],
    "T": ["T", "7"],
    "4": ["4", "A"],
    "A": ["A", "4"],
}


def is_valid_plate(text: str) -> bool:
    if not text:
        return False
    cleaned = "".join(ch for ch in text.upper() if ch.isalnum())
    if ALLOW_DIPLOMATIC and DIPLO_PLATE.match(cleaned):
        return True
    return PLATE_BODY.match(cleaned) and cleaned[:2] in TR_CITY_CODES


def clean_text(text: str) -> str:
    """Strip everything but A-Z 0-9, uppercase."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def char_variants(text: str, max_swaps: int = 2):
    """
    Yield variants of `text` where up to `max_swaps` ambiguous characters are
    swapped to plausible alternatives. Used when the raw text is almost a
    valid plate but a digit/letter looks wrong (5↔S, 0↔O, etc.).
    """
    yield text
    if max_swaps <= 0 or len(text) > 10:
        return

    indices = [i for i, ch in enumerate(text) if ch in CHAR_FIXES]
    if not indices:
        return

    # Try single character swaps first, then double swaps. We don't go deeper
    # because the search space explodes and false positives become likely.
    seen = {text}
    for n in range(1, min(max_swaps, len(indices)) + 1):
        from itertools import combinations, product
        for combo in combinations(indices, n):
            options = [CHAR_FIXES[text[i]] for i in combo]
            for choice in product(*options):
                arr = list(text)
                for idx, ch in zip(combo, choice):
                    arr[idx] = ch
                v = "".join(arr)
                if v not in seen:
                    seen.add(v)
                    yield v


def best_plate_from_substrings(text: str) -> Optional[str]:
    """Search every substring for a valid plate; rank by length and city code."""
    text = clean_text(text)
    if len(text) < 5:
        return None

    found = []
    for length in range(min(len(text), 12), 4, -1):
        for i in range(0, len(text) - length + 1):
            sub = text[i:i + length]
            for variant in char_variants(sub):
                if is_valid_plate(variant):
                    found.append((variant, length))

    if not found:
        return None

    # Prefer longer plates and earlier matches.
    found.sort(key=lambda x: (-x[1], x[0]))
    return found[0][0]


# ---------------------------------------------------------------------------
# Image preprocessing
# ---------------------------------------------------------------------------

def deskew(image: np.ndarray) -> np.ndarray:
    """Try to rotate the image so the plate is horizontal."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 100, minLineLength=100, maxLineGap=10)
    if lines is None:
        return image

    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if -45 < angle < 45:
            angles.append(angle)
    if not angles:
        return image

    median_angle = float(np.median(angles))
    if abs(median_angle) < 0.5:
        return image

    h, w = image.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), median_angle, 1.0)
    return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def upscale_if_small(image: np.ndarray, target_height: int = 60) -> np.ndarray:
    """Upscale very small crops so OCR has enough resolution."""
    h, w = image.shape[:2]
    if h >= target_height:
        return image
    scale = target_height / h
    return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)


def preprocess_for_ocr(image: np.ndarray) -> List[np.ndarray]:
    """
    Produce a small set of preprocessed versions of an image; OCR tries each
    in order and short-circuits when it finds a high-confidence plate.

    We keep the variant count low (3) because each one costs an EasyOCR pass
    (~300-700ms on shared CPU) and the marginal gain from extra variants is
    small compared to running region detection.
    """
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    variants = [image]

    # CLAHE handles dark/uneven lighting well — usually the most useful single
    # preprocessing step for plate photos.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    clahe_img = clahe.apply(gray)
    variants.append(cv2.cvtColor(clahe_img, cv2.COLOR_GRAY2BGR))

    # Adaptive threshold catches plates with strong shadows.
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10
    )
    variants.append(cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR))

    return variants


# ---------------------------------------------------------------------------
# Plate localisation
# ---------------------------------------------------------------------------

def detect_plate_regions(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    Return up to N candidate plate rectangles (x, y, w, h) sorted by likelihood.
    Strategy: morphological gradient + binarisation + contour filtering by
    aspect ratio. This is the technique used by most lightweight ALPR pipelines.
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Top-hat highlights small bright regions (plate text on dark plate is fine
    # because plate background tends to be lighter than surrounding metal).
    rect_kern = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 5))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, rect_kern)

    # Sobel on x picks up vertical strokes of plate characters.
    grad_x = cv2.Sobel(blackhat, ddepth=cv2.CV_32F, dx=1, dy=0, ksize=-1)
    grad_x = np.absolute(grad_x)
    if grad_x.max() > 0:
        grad_x = (255 * grad_x / grad_x.max()).astype("uint8")
    else:
        grad_x = grad_x.astype("uint8")

    grad_x = cv2.GaussianBlur(grad_x, (5, 5), 0)
    grad_x = cv2.morphologyEx(grad_x, cv2.MORPH_CLOSE, rect_kern)
    _, thresh = cv2.threshold(grad_x, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    thresh = cv2.erode(thresh, None, iterations=2)
    thresh = cv2.dilate(thresh, None, iterations=2)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]

    regions = []
    img_area = h * w
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if ch == 0:
            continue
        aspect = cw / ch
        area = cw * ch
        # Turkish plate aspect is typically 3-5:1; allow a wide range.
        if not (1.8 <= aspect <= 6.5):
            continue
        # Filter regions that are too small or implausibly large.
        if area < img_area * 0.0008 or area > img_area * 0.20:
            continue
        # Plates are rarely at the very top of the photo.
        if y < h * 0.05:
            continue
        regions.append((x, y, cw, ch, area))

    # Sort by area descending — bigger candidates first.
    regions.sort(key=lambda r: -r[4])
    return [(x, y, cw, ch) for x, y, cw, ch, _ in regions[:6]]


def paddle_detect_regions(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """
    PaddleOCR detection ile metin region'ları bul, aspect ratio'su plaka
    benzeri olanları filtrele, (x, y, w, h) listesi döner.
    Detector yüklü değilse boş liste — caller Sobel fallback'e gitsin.

    PaddleOCR'ın TextDetection.predict çıktısı framework'ün sürümüne göre
    değişiyor: kimi sürümlerde dict listesi ('dt_polys'), kimi sürümlerde
    Result objesi. Her ikisini de tolere ediyoruz.
    """
    det = _load_paddle()
    if det is None:
        return []
    h, w = image.shape[:2]
    img_area = h * w
    try:
        out = det.predict(input=image, batch_size=1)
    except Exception as exc:
        log.warning("PaddleOCR predict hatası: %s", exc)
        return []

    polys: List[np.ndarray] = []
    items = out if out is not None else []
    for item in items:
        if isinstance(item, dict):
            dp = item.get("dt_polys")
        else:
            dp = getattr(item, "dt_polys", None)
            if dp is None:
                try:
                    dp = item["dt_polys"]
                except Exception:
                    continue
        # dt_polys numpy array veya liste olabilir; truthiness yerine
        # None / boş-uzunluk kontrolü yap (bool(np.ndarray) ValueError atar).
        if dp is None:
            continue
        try:
            if len(dp) == 0:
                continue
        except TypeError:
            continue
        polys.extend(dp)

    regions = []
    for poly in polys:
        arr = np.array(poly).reshape(-1, 2)
        if arr.size == 0:
            continue
        x0, y0 = arr.min(axis=0)
        x1, y1 = arr.max(axis=0)
        x, y = int(max(0, x0)), int(max(0, y0))
        cw, ch = int(x1 - x0), int(y1 - y0)
        if cw <= 0 or ch <= 0:
            continue
        aspect = cw / ch
        area = cw * ch
        # TR plaka aspect 3-5:1 — detection text region olduğu için biraz
        # daha gevşek tut, 2-7 aralığı sıkça plakayı yakalıyor.
        if not (2.0 <= aspect <= 7.0):
            continue
        if area < img_area * 0.0008 or area > img_area * 0.30:
            continue
        regions.append((x, y, cw, ch, area))

    regions.sort(key=lambda r: -r[4])
    return [(x, y, cw, ch) for x, y, cw, ch, _ in regions[:6]]


def expand_box(box: Tuple[int, int, int, int], img_shape, pad_x=0.05, pad_y=0.25):
    """Pad a plate box so OCR has a bit of background around the characters."""
    x, y, w, h = box
    H, W = img_shape[:2]
    px = int(w * pad_x)
    py = int(h * pad_y)
    x0 = max(0, x - px)
    y0 = max(0, y - py)
    x1 = min(W, x + w + px)
    y1 = min(H, y + h + py)
    return x0, y0, x1 - x0, y1 - y0


# ---------------------------------------------------------------------------
# OCR pipeline
# ---------------------------------------------------------------------------

def run_easyocr(image: np.ndarray):
    """
    EasyOCR returns list of (bbox, text, confidence). We concatenate all
    detections and also keep the per-detection list for debugging.
    """
    try:
        result = _reader.readtext(
            image,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            detail=1,
            paragraph=False,
        )
    except Exception as exc:
        log.warning("EasyOCR failed: %s", exc)
        return [], 0.0

    # Sort by x then y so that left-to-right reading order is respected.
    result.sort(key=lambda r: (r[0][0][1], r[0][0][0]))
    texts = [(clean_text(t), float(c)) for _, t, c in result]
    texts = [t for t in texts if t[0]]
    if not texts:
        return [], 0.0
    avg_conf = sum(c for _, c in texts) / len(texts)
    return texts, avg_conf


def extract_plate(detections):
    """
    From a list of (text, confidence) tuples, return the most likely plate.
    1. Concat in reading order, search substrings.
    2. Try each individual detection.
    3. Try permutations of 2-3 detections (handles plates split across boxes).
    """
    if not detections:
        return None, 0.0, "none"

    # Strategy 1: concatenated text.
    joined = "".join(t for t, _ in detections)
    plate = best_plate_from_substrings(joined)
    if plate:
        return plate, sum(c for _, c in detections) / len(detections), "joined"

    # Strategy 2: each detection alone.
    for text, conf in detections:
        candidate = best_plate_from_substrings(text)
        if candidate:
            return candidate, conf, "single"

    # Strategy 3: try pairs of adjacent detections.
    for i in range(len(detections) - 1):
        a, ca = detections[i]
        b, cb = detections[i + 1]
        candidate = best_plate_from_substrings(a + b)
        if candidate:
            return candidate, (ca + cb) / 2, "pair"

    return None, 0.0, "none"


# Confidence eşikleri — sahada ayarlanabilir kalsın diye env ile override.
# ACCEPT: extract_plate zaten yalnız regex-geçerli TR plakası döndürüyor;
# format geçerliyse 0.60 confidence pratikte doğru okumadır (yanlışsa fuzzy
# matcher / kullanıcı onayı yakalar). Eski 0.85 eşiği EasyOCR'ın plakalarda
# tipik 0.5-0.8 verdiği gerçeğiyle uyuşmuyordu → her foto tüm pipeline'ı
# çalıştırıp ~36s sürüyordu (2026-06-12 saha testi, ocr_metrics p50=36s).
# LOW: bunun altındaysa cevaba needs_manual_review=true koy, kullanıcı UI'da
# uyarıyla göstersin (yanlış plaka tahminiyle onay almaktansa direkt iste).
CONFIDENCE_HIGH = float(os.environ.get("OCR_CONFIDENCE_HIGH", "0.85"))
CONFIDENCE_ACCEPT = float(os.environ.get("OCR_CONFIDENCE_ACCEPT", "0.60"))
CONFIDENCE_MANUAL_REVIEW = float(os.environ.get("OCR_CONFIDENCE_MANUAL_REVIEW", "0.5"))

# Toplam süre bütçesi — bütçe dolunca eldeki en iyi sonuçla dön. Backend
# PYTHON_OCR_TIMEOUT_MS=15s beklediği için burada 9s güvenli tavan: 9s'de
# yerel olarak çözülemeyen fotoğraflar pratikte Plate Recognizer'a gidiyor
# (2026-06-12 gece batch'i: hızlı yol p50=1.8s, yavaş yol PR ile çözüldü) —
# beklemeyi uzatmak yalnız toplam süreyi şişiriyor.
TIME_BUDGET_S = float(os.environ.get("OCR_TIME_BUDGET_S", "9"))


def recognize(image_bytes: bytes, debug: bool = False):
    started = time.monotonic()

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Image could not be decoded")

    # Limit very large photos so OCR doesn't time out.
    h, w = img.shape[:2]
    max_side = 1600
    if max(h, w) > max_side:
        scale = max_side / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    img = deskew(img)

    debug_info = {"strategies": []}
    best = {"plate": None, "confidence": 0.0, "strategy": None, "raw": []}

    def out_of_budget():
        return (time.monotonic() - started) > TIME_BUDGET_S

    def accepted():
        return best["plate"] and best["confidence"] >= CONFIDENCE_ACCEPT

    def try_image(image_to_ocr, label):
        detections, avg_conf = run_easyocr(image_to_ocr)
        plate, conf, sub_strategy = extract_plate(detections)
        debug_info["strategies"].append({
            "label": label,
            "detections": [{"text": t, "confidence": round(c, 3)} for t, c in detections],
            "plate": plate,
            "sub_strategy": sub_strategy,
            "confidence": round(conf, 3),
        })
        if plate and conf > best["confidence"]:
            best["plate"] = plate
            best["confidence"] = conf
            best["strategy"] = f"{label}/{sub_strategy}"
            best["raw"] = [t for t, _ in detections]

    # Pass 1: region-first. Plaka crop'larında EasyOCR çağrısı küçük görüntü
    # sayesinde ~0.3-1s; tam görüntüde 5-15s. Önce ucuz yolu dene, geçerli
    # plaka + yeterli confidence bulununca hemen dön. Tam-görüntü taramaları
    # yalnız region'lar sonuç veremezse çalışır (Pass 2).
    used_paddle = False
    regions = paddle_detect_regions(img)[:3]
    if regions:
        used_paddle = True
        debug_info["detector"] = "paddle"
    else:
        regions = detect_plate_regions(img)[:3]
        debug_info["detector"] = "sobel"
    for r_idx, region in enumerate(regions):
        box = expand_box(region, img.shape)
        x, y, bw, bh = box
        crop = img[y:y + bh, x:x + bw]
        if crop.size == 0:
            continue
        crop = upscale_if_small(crop, target_height=80)
        for v_idx, variant in enumerate(preprocess_for_ocr(crop)):
            try_image(variant, f"region-{r_idx}-{v_idx}")
            if accepted() or out_of_budget():
                break
        if accepted() or out_of_budget():
            break

    # Pass 2: full-image fallback. Region detection plakayı bulamadıysa
    # (ör. plaka çok yakın çekilmiş, detection box'ı parçalamış) tam görüntü
    # variant'larını dene. Tek bir tam-görüntü EasyOCR taraması yoğun CPU'da
    # 10-20s sürebiliyor ve bütçe yalnız taramalar ARASINDA kontrol edildiği
    # için 30s timeout'ları buradan geliyordu (2026-06-12 batch: 10/61 foto).
    # İki önlem: tam taramalar küçültülmüş görüntüde (max 1000px) yapılır ve
    # kalan bütçe bir taramaya yetmeyecekse hiç başlanmaz.
    FULL_PASS_MIN_BUDGET_S = 3.0
    if not accepted() and not out_of_budget():
        full_img = img
        fh, fw = img.shape[:2]
        if max(fh, fw) > 1000:
            fscale = 1000 / max(fh, fw)
            full_img = cv2.resize(img, (int(fw * fscale), int(fh * fscale)), interpolation=cv2.INTER_AREA)
        for idx, variant in enumerate(preprocess_for_ocr(full_img)):
            if (time.monotonic() - started) > (TIME_BUDGET_S - FULL_PASS_MIN_BUDGET_S):
                break
            try_image(variant, f"full-{idx}")
            if accepted() or out_of_budget():
                break

    elapsed = time.monotonic() - started
    confidence = best["confidence"]
    # Düşük confidence işareti — frontend bunu görünce "OCR güveni düşük,
    # plakayı kontrol edin" uyarısı verir; otomatik onay akışından çıkar.
    needs_manual_review = (not best["plate"]) or (confidence < CONFIDENCE_MANUAL_REVIEW)

    # Engine etiketi: Node tarafı bunu ocr_metrics.ocr_engine'a yazıyor.
    # A/B kıyaslamasında "paddle_det+easyocr" vs "easyocr" doğruluğu
    # OCR İstatistik sayfasında karşılaştırılır.
    if used_paddle:
        engine = "paddle_det+easyocr"
    elif _paddle_detector is not None:
        # Paddle yüklü ama bu fotoğrafta region bulamadı; pass 1'de erken
        # çıkış olduysa region detection hiç çalışmamış olabilir.
        engine = "easyocr+paddle_available"
    else:
        engine = "easyocr"

    response = {
        "plate": best["plate"] or "",
        "confidence": round(confidence, 3),
        "strategy": best["strategy"],
        "engine": engine,
        "elapsed_ms": int(elapsed * 1000),
        "raw_text": " ".join(best["raw"]) if best["raw"] else "",
        "needs_manual_review": needs_manual_review,
    }
    if debug:
        response["debug"] = debug_info
        response["thresholds"] = {
            "high": CONFIDENCE_HIGH,
            "region_exit": CONFIDENCE_REGION_EXIT,
            "min_auto": CONFIDENCE_MIN_AUTO,
            "manual_review": CONFIDENCE_MANUAL_REVIEW,
        }
        response["paddle_load_error"] = _paddle_load_error
    return response


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------
app = FastAPI(title="ParkTrack OCR", version="2.0.0")

# ---------------------------------------------------------------------------
# Auth — shared secret
# ---------------------------------------------------------------------------
# Servis public URL'de (parktrack-ocr.fly.dev) yaşıyor; OCR_API_KEY set
# edildiğinde /ocr yalnız doğru X-OCR-KEY header'ı ile çağrılabilir. Aksi
# halde herkes CPU'yu kullanabilir (maliyet + tek worker'ı doldurma riski).
# /health açık kalır — Fly health check'leri header gönderemiyor.
# Rollout: önce her iki app'e secret'ı koy, sonra enforce otomatik başlar.
OCR_API_KEY = os.environ.get("OCR_API_KEY", "")
if not OCR_API_KEY:
    log.warning("OCR_API_KEY tanımlı değil — /ocr endpoint'i kimlik doğrulamasız çalışıyor!")


def _check_api_key(provided: Optional[str]) -> None:
    if not OCR_API_KEY:
        return  # enforce kapalı (lokal dev / henüz secret atanmamış)
    import hmac
    if not provided or not hmac.compare_digest(provided, OCR_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-OCR-KEY")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engine": "easyocr",
        "version": "2.1.0",
        "paddle_loaded": _paddle_detector is not None,
        "paddle_error": _paddle_load_error,
    }


# OCR CPU-bound ve senkron — async endpoint içinde direkt çağrılırsa worker'ın
# event loop'u OCR süresince bloklanır: yeni bağlantılar accept edilemez, Fly
# proxy "os error 110" ile 502 üretir (2026-06-12 saha testinde her yüklemede
# görüldü). Çözüm: recognize'ı threadpool'a at, event loop serbest kalsın.
# Semaphore worker başına tek OCR'a izin verir — 2 shared vCPU'da paralel OCR
# birbirini yavaşlatmaktan başka işe yaramıyor; fazlası sırada bekler.
_ocr_semaphore = asyncio.Semaphore(int(os.environ.get("OCR_MAX_CONCURRENT", "1")))


@app.post("/ocr")
async def ocr(
    file: UploadFile = File(...),
    debug: bool = False,
    x_ocr_key: Optional[str] = Header(default=None),
):
    _check_api_key(x_ocr_key)
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 12MB)")
    try:
        async with _ocr_semaphore:
            result = await run_in_threadpool(recognize, content, debug)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("OCR failed")
        return JSONResponse(status_code=500, content={"error": str(exc)})
    return result


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "5000"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
