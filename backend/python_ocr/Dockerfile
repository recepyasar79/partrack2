FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    EASYOCR_MODULE_PATH=/root/.EasyOCR

WORKDIR /app

# OpenCV runtime libs + curl for the model warmup
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    curl \
 && rm -rf /var/lib/apt/lists/*

# PaddlePaddle CPU wheel: official PyPI'da yok, Baidu kendi index'inde
# yayınlıyor. Bu wheel'i ayrı bir adımda çekiyoruz ki torch/easyocr resolution'a
# karışmasın (PaddlePaddle protobuf/numpy çakışmaları sevmiyor).
RUN pip install paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/

# Install Python deps in a single resolution pass so pip can pick mutually
# compatible versions of torch/numpy/easyocr. Pinning torch==2.2.2 here while
# requirements.txt asked for numpy>=1.26 caused torch to load against numpy 2.x
# at runtime ("Numpy is not available") because that torch wheel was built
# against numpy 1.x. Letting pip resolve from a single index avoids the split.
COPY requirements.txt .
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Pre-download EasyOCR weights so the first request doesn't pay the cold start
# cost. ~70MB total; baked into the image.
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False, verbose=False)"

# Pre-download PaddleOCR PP-OCRv4 detection model (~5MB). PaddleOCR ilk
# TextDetection çağrısında model dosyasını indirip ~/.paddlex/ altına atıyor;
# build sırasında bunu tetikliyoruz ki runtime cold start temiz olsun. Hata
# olursa devam et — runtime'da Sobel fallback'i devreye girer.
RUN python -c "from paddleocr import TextDetection; TextDetection(model_name='PP-OCRv4_mobile_det')" || \
    echo "[build] PaddleOCR model pre-download başarısız, runtime'da Sobel fallback kullanılacak"

COPY app.py .

EXPOSE 5000
# 2 worker: tek worker'da EasyOCR sync olduğu için ikinci foto'nun serbest
# beklemesi gerekiyordu (frontend MAX_CONCURRENT=1 olmak zorundaydı).
# 2 worker + 3GB RAM ile iki paralel OCR + güvenlik marjı.
# Her worker EasyOCR weights'i RAM'e yüklediği için baseline ~800MB/worker.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "2"]
