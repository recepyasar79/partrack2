const path = require('path');
const fs = require('fs');
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

function buildUpload() {
  if (isR2Configured()) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const multerS3 = require('multer-s3');
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    return {
      mode: 'r2',
      upload: multer({
        storage: multerS3({
          s3,
          bucket: process.env.R2_BUCKET,
          contentType: multerS3.AUTO_CONTENT_TYPE,
          key: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
            const ts = Date.now();
            const rand = Math.random().toString(36).slice(2, 8);
            cb(null, `kontroller/${new Date().toISOString().slice(0, 10)}/${ts}_${rand}${ext}`);
          },
        }),
        limits: { fileSize: MAX_BYTES },
        fileFilter,
      }),
      publicUrl: (key) => {
        if (process.env.R2_PUBLIC_URL) return `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
        return `r2://${process.env.R2_BUCKET}/${key}`;
      },
    };
  }

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  return {
    mode: 'disk',
    uploadDir,
    upload: multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
          const ts = Date.now();
          const rand = Math.random().toString(36).slice(2, 8);
          cb(null, `${ts}_${rand}${ext}`);
        },
      }),
      limits: { fileSize: MAX_BYTES },
      fileFilter,
    }),
    publicUrl: (filename) => `/uploads/${filename}`,
  };
}

module.exports = { buildUpload, isR2Configured, MAX_BYTES, ALLOWED_MIME };
