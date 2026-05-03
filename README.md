# ParkTrack — Site Otopark Yönetim Sistemi

Site içindeki araç park düzenini otomatikleştirir: her dairenin sadece 1 aracının gece konaklaması kuralını izler, ihlalleri tespit eder ve WhatsApp ile bilgilendirme yapar.

## Teknoloji Stack

- **Frontend:** React + Vite + TailwindCSS (PWA, mobil-first)
- **Backend:** Node.js + Express + PostgreSQL (Knex migration)
- **OCR:** Tesseract.js (client-side plaka okuma)
- **Foto storage:** Cloudflare R2 (lokal disk fallback)
- **Bildirim:** WhatsApp Business Cloud API (Meta)
- **Hosting:** Render (backend + DB + cron'lar), Vercel (frontend)

Tüm proje kararları, fazlar ve iş kuralları için → [CLAUDE.md](./CLAUDE.md)

## Geliştirme Kurulumu

```bash
# 1. .env dosyasını hazırla
cp .env.example .env
# .env dosyasını gerçek değerlerle doldur

# 2. Lokal PostgreSQL (Docker varsa)
docker run --name parktrack-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=parktrack -p 5432:5432 -d postgres:16

# 3. Backend
cd backend
npm install
npm run migrate
npm run seed       # development seed data (admin + 1 güvenlik + örnek daireler)
npm run dev        # http://localhost:3000

# 4. Frontend (yeni terminal)
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

## Cloud Deploy (Render + Vercel)

### 1. Cloudflare R2 hesabı + bucket aç
- API token oluştur (R2 Edit yetkisi)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` env değerlerini al

### 2. WhatsApp Business Cloud API (Meta)
- Meta Business Verification başvurusu (1-3 gün)
- Phone Number kayıt + onay
- `ihlal_bildirimi` template'ini Meta'ya submit et (Türkçe, 3 parametreli: sahip_ad, daire_no, plakalar)
- `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` al

### 3. Render Blueprint deploy
```
# Render dashboard → New → Blueprint → bu repo
# render.yaml otomatik tespit edilir
# Eksik env var'ları (BOOTSTRAP_ADMIN_*, R2_*, WHATSAPP_*, FRONTEND_URL) dashboard'dan girilir
```

Servisler:
- `parktrack-api` (web service)
- `parktrack-db` (managed PostgreSQL)
- `parktrack-foto-temizle` (cron, günlük 03:00)
- `parktrack-bildirim-retry` (cron, 5dk'da bir)

### 4. Vercel'e frontend deploy
```bash
cd frontend
# Vercel dashboard → Import → bu repo → root: frontend
# Env: VITE_API_URL=https://parktrack-api.onrender.com/api
```

### 5. Frontend domain'i Render CORS whitelist'ine ekle
- Render dashboard → parktrack-api → Environment → `FRONTEND_URL=https://parktrack.vercel.app`

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
├── render.yaml             Render Blueprint
└── .github/workflows/      CI/CD
```

## Önemli Notlar

- **Saat dilimi:** Backend, DB ve frontend `Europe/Istanbul`. Kontrol günü TR saatinde belirlenir.
- **KVKK:** Daire eklerken açık rıza zorunlu. WhatsApp bildirimi ayrıca opt-in. `/kvkk` public sayfasında aydınlatma metni.
- **Foto saklama:** 90 gün, sonra cron ile R2/disk + DB'den silinir.
- **İhlal idempotency:** Aynı gün tekrar analiz çalıştırılırsa ihlal kayıtları upsert edilir, bildirim çift gönderilmez.

## Lisans

Özel — site yönetimine ait.
