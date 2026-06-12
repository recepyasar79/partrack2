require('dotenv').config({ path: '../../.env' });

const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const db = require('../db');
const { isR2Configured } = require('../services/storage');
const { todayTR } = require('../utils/timezone');

// İki kademeli saklama:
//  - Foto dosyaları (R2/disk): FOTO_FILE_KEEP_DAYS gün — KVKK + depolama
//    maliyeti. 1 = yalnız bugünün fotoğrafları kalır, dün ve öncesi silinir.
//    Silinen kayıtların foto_url'i NULL yapılır ki UI temiz "foto yok"
//    göstersin (404'lü kırık görsel yerine).
//  - DB kayıtları (gunluk_kontroller satırları): FOTO_KEEP_DAYS gün —
//    kontrol geçmişi ve raporlar için plaka kayıtları daha uzun yaşar.
const FILE_KEEP_DAYS = parseInt(process.env.FOTO_FILE_KEEP_DAYS || '1', 10);
const KEEP_DAYS = parseInt(process.env.FOTO_KEEP_DAYS || '90', 10);

// foto_url tam URL (R2) ya da /uploads/... (disk). R2 key'i = URL path'i.
// Eski regex `sites/{id}/` prefix'ini düşürüyordu → DeleteObject sessizce
// yanlış key'e gidiyordu; URL parse ile her iki path düzeni de doğru çıkar.
function r2KeyFromUrl(fotoUrl) {
  try {
    return new URL(fotoUrl).pathname.replace(/^\//, '');
  } catch (_) {
    return null; // /uploads/... gibi göreli path'ler R2'de değil
  }
}

async function main() {
  const fileCutoff = dayjs(todayTR()).subtract(FILE_KEEP_DAYS - 1, 'day').format('YYYY-MM-DD');
  const recordCutoff = dayjs(todayTR()).subtract(KEEP_DAYS, 'day').format('YYYY-MM-DD');

  // 1) Foto dosyaları
  const eskiFotolar = await db('gunluk_kontroller')
    .where('kontrol_tarihi', '<', fileCutoff)
    .whereNotNull('foto_url')
    .select('id', 'foto_url');

  console.log(`[fotoTemizle] ${fileCutoff} öncesi ${eskiFotolar.length} foto dosyası silinecek (${FILE_KEEP_DAYS} gün eşiği).`);

  const silinenIds = [];
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
      for (const k of eskiFotolar) {
        const key = r2KeyFromUrl(k.foto_url);
        if (!key) {
          silinenIds.push(k.id); // R2'de olmayan legacy path — URL'i yine temizle
          continue;
        }
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
          silinenIds.push(k.id);
        } catch (err) {
          console.warn(`[fotoTemizle] R2 silme hatası ${key}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[fotoTemizle] R2 client yüklenemedi:', err.message);
    }
  } else {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));
    for (const k of eskiFotolar) {
      const filename = k.foto_url.split('/').pop();
      const fp = path.join(uploadDir, filename);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        silinenIds.push(k.id);
      } catch (err) {
        console.warn(`[fotoTemizle] disk silme hatası ${fp}: ${err.message}`);
      }
    }
  }

  if (silinenIds.length) {
    await db('gunluk_kontroller').whereIn('id', silinenIds).update({ foto_url: null });
  }
  console.log(`[fotoTemizle] ${silinenIds.length} foto silindi, foto_url temizlendi.`);

  // 2) Eski DB kayıtları (plaka geçmişi dahil)
  const silindi = await db('gunluk_kontroller').where('kontrol_tarihi', '<', recordCutoff).delete();
  console.log(`[fotoTemizle] ${recordCutoff} öncesi ${silindi} DB kaydı silindi (${KEEP_DAYS} gün eşiği).`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[fotoTemizle] hata:', err);
  process.exit(1);
});
