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

function r2KeyFor(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex');
  return `kontroller/${new Date().toISOString().slice(0, 10)}/${ts}_${rand}${ext}`;
}

function diskFilenameFor(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex');
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
      async save(buffer, originalName, mimeType) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const key = r2KeyFor(originalName);
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
    async save(buffer, originalName) {
      const filename = diskFilenameFor(originalName);
      const filepath = path.join(uploadDir, filename);
      await fs.promises.writeFile(filepath, buffer);
      return { key: filename, url: publicUrlForDisk(filename) };
    },
  };
}

module.exports = { buildUpload, isR2Configured, MAX_BYTES, ALLOWED_MIME };
