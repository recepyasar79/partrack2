const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    const err = new Error('Sadece JPG/PNG/WEBP yüklenebilir.');
    err.status = 400;
    return cb(err, false);
  }
  cb(null, true);
}

/**
 * Magic-byte tabanlı görüntü tipi tespiti. fileFilter yalnız istemci
 * MIME'ına bakar (spoof edilebilir); bu, buffer içeriğinden gerçek tipi
 * doğrular — upload handler'ı OCR/depolamadan ÖNCE çağırır.
 * @param {Buffer} buffer
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null} tanınmazsa null
 */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  // WEBP: 'RIFF' [4 byte boyut] 'WEBP'
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  return null;
}

// Multi-tenant: site_id prefix R2 path'inde yer alır. Eski (single-tenant)
// foto'ların foto_url'leri DB'de tam URL olarak saklı → migration yok,
// yalnızca yeni upload'lar sites/{siteId}/... altına yazılır.
function r2KeyFor(originalName, siteId) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex');
  const date = new Date().toISOString().slice(0, 10);
  if (siteId != null) {
    return `sites/${siteId}/kontroller/${date}/${ts}_${rand}${ext}`;
  }
  // Geriye uyumluluk: siteId yoksa eski path (yeni kullanım yok ama
  // testler eskileri çağırabilir).
  return `kontroller/${date}/${ts}_${rand}${ext}`;
}

function diskFilenameFor(originalName, siteId) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex');
  if (siteId != null) {
    return `site${siteId}_${ts}_${rand}${ext}`;
  }
  return `${ts}_${rand}${ext}`;
}

let s3Client = null;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

function publicUrlForR2(key) {
  if (process.env.R2_PUBLIC_URL) return `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  return `r2://${process.env.R2_BUCKET}/${key}`;
}

function publicUrlForDisk(filename) {
  return `/uploads/${filename}`;
}

function buildUpload() {
  // Memory storage so we have direct access to the file buffer for OCR before
  // shipping it off to R2 or disk. The 10MB limit keeps memory usage bounded.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
    fileFilter,
  });

  if (isR2Configured()) {
    return {
      mode: 'r2',
      upload,
      publicUrl: publicUrlForR2,
      // save(buffer, name, mime, { siteId }) — siteId opsiyonel ama yeni
      // upload'larda zorunlu. Eksikse legacy path kullanılır (test'ler için).
      async save(buffer, originalName, mimeType, opts = {}) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const key = r2KeyFor(originalName, opts.siteId);
        await getS3().send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: mimeType || 'image/jpeg',
          })
        );
        return { key, url: publicUrlForR2(key) };
      },
    };
  }

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  return {
    mode: 'disk',
    uploadDir,
    upload,
    publicUrl: publicUrlForDisk,
    async save(buffer, originalName, _mimeType, opts = {}) {
      const filename = diskFilenameFor(originalName, opts.siteId);
      const filepath = path.join(uploadDir, filename);
      await fs.promises.writeFile(filepath, buffer);
      return { key: filename, url: publicUrlForDisk(filename) };
    },
  };
}

module.exports = { buildUpload, isR2Configured, sniffImageType, MAX_BYTES, ALLOWED_MIME };
