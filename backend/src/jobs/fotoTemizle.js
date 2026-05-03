require('dotenv').config({ path: '../../.env' });

const path = require('path');
const fs = require('fs');
const db = require('../db');
const { isR2Configured } = require('../services/storage');

const KEEP_DAYS = parseInt(process.env.FOTO_KEEP_DAYS || '90', 10);

async function main() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  console.log(`[fotoTemizle] ${cutoffDate} öncesi kayıtlar siliniyor (${KEEP_DAYS} gün eşiği).`);

  const eskiler = await db('gunluk_kontroller')
    .where('kontrol_tarihi', '<', cutoffDate)
    .select('id', 'foto_url');

  console.log(`[fotoTemizle] ${eskiler.length} kayıt bulundu.`);

  if (isR2Configured()) {
    try {
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      for (const k of eskiler) {
        if (!k.foto_url) continue;
        const key = k.foto_url.replace(/^.*?(kontroller\/)/, '$1');
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
        } catch (err) {
          console.warn(`[fotoTemizle] R2 silme hatası ${key}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[fotoTemizle] R2 client yüklenemedi:', err.message);
    }
  } else {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
    for (const k of eskiler) {
      if (!k.foto_url) continue;
      const filename = k.foto_url.split('/').pop();
      const fp = path.join(uploadDir, filename);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (err) {
        console.warn(`[fotoTemizle] disk silme hatası ${fp}: ${err.message}`);
      }
    }
  }

  const silindi = await db('gunluk_kontroller').where('kontrol_tarihi', '<', cutoffDate).delete();
  console.log(`[fotoTemizle] ${silindi} DB kaydı silindi.`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[fotoTemizle] hata:', err);
  process.exit(1);
});
