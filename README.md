# ParkTrack — Site Otopark Yönetim Sistemi

Site içindeki araç park düzenini otomatikleştirir: her dairenin sadece 1 aracının gece konaklaması kuralını izler, ihlalleri tespit eder ve WhatsApp ile bilgilendirme yapar.

## Teknoloji Stack

- **Frontend:** React + Vite + TailwindCSS (PWA, mobil-first, gece/gündüz tema)
- **Backend:** Node.js + Express + PostgreSQL (Knex migration)
- **OCR:** Python microservice (FastAPI + EasyOCR + OpenCV) — sunucu tarafında plaka okuma
- **Foto storage:** Cloudflare R2 (lokal disk fallback)
- **Bildirim:** WhatsApp Business Cloud API (Meta)
- **Hosting:** Fly.io (backend + OCR), Neon (PostgreSQL), Vercel (frontend)

Tüm proje kararları, fazlar ve iş kuralları için → [CLAUDE.md](./CLAUDE.md)

## Geliştirme Kurulumu

```bash
# 1. .env dosyasını hazırla
cp .env.example .env
# .env dosyasını gerçek değerlerle doldur

# 2. Lokal PostgreSQL (Docker varsa)
docker run --name parktrack-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=parktrack -p 5432:5432 -d postgres:16

# 3. Python OCR mikroservisi (Docker ile)
docker compose up -d python-ocr   # ilk seferde ~5dk (imaj build + EasyOCR weights)
# veya host'ta çalıştırmak için: cd backend/python_ocr && pip install -r requirements.txt && uvicorn app:app --port 5000

# 4. Backend
cd backend
npm install
npm run migrate
npm run seed       # development seed data (admin + 1 güvenlik + örnek daireler)
npm run dev        # http://localhost:3001

# 5. Frontend (yeni terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

İlk girişte: kullanıcı adı `admin`, şifre `.env` dosyasındaki `BOOTSTRAP_ADMIN_PASS`.

## Komutlar

### Backend
- `npm run dev` — nodemon ile geliştirme sunucusu
- `npm start` — production sunucu
- `npm test` — Jest testleri
- `npm run migrate` / `migrate:rollback` — DB migration
- `npm run seed` — seed data
- `npm run job:foto-temizle` — 90 günden eski foto/kayıtları sil (cron)
- `npm run job:bildirim-retry` — beklemede bildirimleri tekrar dene (cron)

### Frontend
- `npm run dev` — Vite dev sunucusu
- `npm run build` — production build
- `npm test` — Vitest testleri

## Cloud Deploy (Fly.io + Neon + Vercel)

### 1. Cloudflare R2 hesabı + bucket aç
- API token oluştur (R2 Edit yetkisi)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` env değerlerini al

### 2. WhatsApp Business Cloud API (Meta)
- Meta Business Verification başvurusu (1-3 gün)
- Phone Number kayıt + onay
- `ihlal_bildirimi` template'ini Meta'ya submit et (Türkçe, 3 parametreli: sahip_ad, daire_no, plakalar)
- `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` al

### 3. Neon PostgreSQL veritabanı oluştur
- [Neon](https://neon.tech) hesabı aç, yeni proje oluştur
- Connection string'i kopyala
- Fly.io secret olarak ekle: `fly secrets set DATABASE_URL="postgresql://..."`

### 4. Python OCR servisini Fly.io'ya deploy et
```bash
cd backend/python_ocr
fly launch --copy-config --name parktrack-ocr --region fra --no-deploy
fly deploy
# URL'i not al: https://parktrack-ocr.fly.dev
```
EasyOCR weights Docker imajına bake edildiği için cold start ~5sn. Bellek için en az 1GB makine gerekli (`fly.toml`'da 2GB ayarlı).

### 5. Fly.io'ya backend deploy
```bash
cd backend
# Fly CLI kurulum (https://fly.io/docs/hands-on/install-flyctl/)
fly launch --name parktrack-backend --region fra
# fly.toml zaten mevcut, gerekli env değerlerini ekle:
fly secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="uzgun-rastgele-string" \
  BOOTSTRAP_ADMIN_USER="admin" \
  BOOTSTRAP_ADMIN_PASS="güçlü-şifre" \
  FRONTEND_URL="https://akasyaparktrack.vercel.app" \
  PYTHON_OCR_URL="https://parktrack-ocr.fly.dev" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="parktrack-photos" \
  R2_PUBLIC_URL="https://pub-xxx.r2.dev" \
  WHATSAPP_API_TOKEN="..." \
  WHATSAPP_PHONE_NUMBER_ID="..."

fly deploy
```

Servisler:
- `parktrack-backend` (Fly.io web service)
- `parktrack-ocr` (Fly.io Python OCR mikroservis)
- `parktrack-db` (Neon managed PostgreSQL)

### 5b. Cron'ları Fly.io scheduled machines'e bağla (Faz Ü6)

Backend deploy bittikten sonra bir kez çalıştırılır; her cron job için
ayrı ephemeral machine oluşturur:

```bash
# Linux/Mac
./scripts/setup-fly-cron.sh

# Windows PowerShell
.\scripts\setup-fly-cron.ps1
```

Kurulan job'lar:
| Job                       | Schedule | Komut                            |
| ------------------------- | -------- | -------------------------------- |
| data-retention            | daily    | `npm run job:data-retention`     |
| foto-temizle              | daily    | `npm run job:foto-temizle`       |
| parasut-sync              | daily    | `npm run job:parasut-sync`       |
| subscription-lifecycle    | daily    | `npm run job:subscription-lifecycle` |
| email-raporu              | daily    | `npm run job:email-raporu`       |
| bildirim-retry            | hourly   | `npm run job:bildirim-retry`     |

Script idempotent: tekrar çalıştırılırsa eski `cron-*` machines temizlenir
ve yeniden oluşturulur. Image değiştiğinde yeniden çalıştırın.

### 6. Vercel'e frontend deploy
```bash
cd frontend
# Vercel dashboard → Import → bu repo → root: frontend
# Env: VITE_API_URL=https://parktrack-backend.fly.dev/api
```

### 7. Frontend domain'i Fly.io CORS whitelist'ine ekle
- `fly secrets set FRONTEND_URL=https://parktrack.vercel.app`

## Proje Yapısı

```
parktrack/
├── backend/
│   ├── src/
│   │   ├── routes/         auth, daireler, araclar, kontroller, bildirimler, ...
│   │   ├── middleware/     auth, audit, errorHandler
│   │   ├── services/       storage (R2/disk), whatsapp
│   │   ├── jobs/           fotoTemizle, bildirimRetry (cron)
│   │   ├── utils/          validators, auth, violations, timezone
│   │   └── server.js
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── pages/          Login, Daireler, AracListesi, Kontrol, Raporlar, ...
│   │   ├── components/     DaireForm, PlakaListesi, Layout, ui/...
│   │   ├── auth/           AuthContext, ProtectedRoute
│   │   ├── services/       api, plateOCR
│   │   └── utils/          validation, csv, constants
│   └── public/             manifest, sw, favicon
├── database/
│   ├── migrations/         9 tablo (Knex)
│   └── seeds/              bootstrap admin + örnek veri
├── fly.toml                Fly.io konfigürasyonu
├── Dockerfile              Fly.io Docker build
└── .github/workflows/      CI/CD
```

## Önemli Notlar

- **Saat dilimi:** Backend, DB ve frontend `Europe/Istanbul`. Kontrol günü TR saatinde belirlenir.
- **KVKK:** Daire eklerken açık rıza zorunlu. WhatsApp bildirimi ayrıca opt-in. `/kvkk` public sayfasında aydınlatma metni.
- **Foto saklama:** 90 gün, sonra cron ile R2/disk + DB'den silinir.
- **İhlal idempotency:** Aynı gün tekrar analiz çalıştırılırsa ihlal kayıtları upsert edilir, bildirim çift gönderilmez.

## Lisans

Özel — site yönetimine ait.
