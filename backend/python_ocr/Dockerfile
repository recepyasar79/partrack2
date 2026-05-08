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

# Install Python deps. torch comes in CPU-only flavour to keep the image small;
# easyocr will pull torchvision compatible with the pinned version.
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2 torchvision==0.17.2 \
 && pip install -r requirements.txt

# Pre-download EasyOCR weights so the first request doesn't pay the cold start
# cost. ~70MB total; baked into the image.
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False, verbose=False)"

COPY app.py .

EXPOSE 5000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
