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

COPY app.py .

EXPOSE 5000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
