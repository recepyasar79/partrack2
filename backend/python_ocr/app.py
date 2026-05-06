from flask import Flask, request, jsonify
import cv2
import numpy as np
import pytesseract
import sys
import os

app = Flask(__name__)

# Tesseract path (Docker/Linux için genelde gerekmez)
# pytesseract.pytesseract.tesseract_cmd = r'/usr/bin/tesseract'

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'tesseract': 'configured'})

@app.route('/ocr', methods=['POST'])
def ocr_plate():
    if 'file' not in request.files:
        return jsonify({'error': 'Dosya yok'}), 400
    
    file = request.files['file']
    img_bytes = file.read()
    
    # Bytes -> numpy array -> OpenCV image
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        return jsonify({'error': 'Resim okunamadı'}), 400
    
    # Python kodundaki işlemler
    img = cv2.resize(img, (600, 400))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 13, 15, 15)
    edged = cv2.Canny(gray, 30, 200)
    
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
    
    screenCnt = None
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.018 * peri, True)
        if len(approx) == 4:
            screenCnt = approx
            break
    
    if screenCnt is None:
        # Plaka bölgesi bulunamadı, tüm resmi OCR ile dene
        text = pytesseract.image_to_string(gray, config='--psm 7')
        return jsonify({'plate': text.strip(), 'method': 'full_image'})
    
    # Plaka bölgesini kırp
    mask = np.zeros(gray.shape, np.uint8)
    new_image = cv2.drawContours(mask, [screenCnt], 0, 255, -1)
    new_image = cv2.bitwise_and(img, img, mask=mask)
    
    (x, y) = np.where(mask == 255)
    topx, topy = np.min(x), np.min(y)
    bottomx, bottomy = np.max(x), np.max(y)
    Cropped = gray[topx:bottomx+1, topy:bottomy+1]
    
    # OCR
    text = pytesseract.image_to_string(Cropped, config='--psm 7')
    
    return jsonify({
        'plate': text.strip(),
        'method': 'plate_detected',
        'confidence': 'high'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
