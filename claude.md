# CLAUDE.md - Site Otopark Yönetim Sistemi (ParkTrack)

## Proje Bilgileri
- **Proje Adı:** ParkTrack - Site Otopark Yönetim Sistemi
- **Amaç:** Site içindeki araç park düzenini otomatikleştirerek her dairenin sadece 1 aracının gece konaklamasını sağlamak
- **Hedef Kullanıcılar:** Güvenlik görevlileri, site yöneticileri

## İş Kuralları (KRİTİK)
1. Her daireye sayısız araç plakası tanımlanabilir
2. Her daireye ait tanımlı araçlardan **sadece 1 tanesi** gece konaklaması yapabilir
3. Kontrol saati: **Akşam 20:00 (8 PM)**
4. Bloklar: **A, B, C, D** (4 blok)
5. Her blokta: **34 daire** (toplam 136 daire)
6. Daire formatı: `{Blok}{SıraNo}` örn: B3, A21, D34

7. Misafir araclar aksam kontrolune **dahil edilir**; ilgili dairenin sayimina girer ve raporda plaka yaninda `misafir` notu gosterilir
8. Aktif misafir plaka kayitsiz plaka olarak raporlanmaz; misafir kaydi yoksa kayitsiz plaka listesine duser

## 2. Arac Park Hakki (2026-06-17)

Bazi daireler — site bazinda belirlenen KOTA dahilinde — gece otoparkta 2. araca da izinli isaretlenebilir.

- **Migration `20260617000001`:** `daireler.ikinci_arac_izinli BOOL default false` + `sites.ikinci_arac_kapasitesi INT default 0`. Aktif musteri (site id=1) kapasitesi **10** backfill edildi.
- **Is kurali (`utils/violations.js`):** izinli daire 2 araca kadar ihlal SAYILMAZ; sinir `ikinci_arac_izinli ? 2 : 1`. 3+ araçta yine akşam kontrolune duser. Misafir araclar bu sayima dahil (mevcut kural degismedi).
- **Kota (`routes/daireler.js`):** POST/PUT/bulk-import izinli isaretlemede `sites.ikinci_arac_kapasitesi` asilmamali. Asilirsa **409** + mesaj: *"Sitede en fazla {kota} daire için ikinci araç izni verebilirsiniz."* PUT'ta false→true gecisinde kendi satirini saymaz.
- **Kota ayari:** superadmin `PATCH /api/sites/:id` ile `ikinci_arac_kapasitesi` set eder. `auth login`/`me` site payload'ina eklendi → frontend checkbox'i yalniz kota>0 ise gosterir.
- **Frontend:** `DaireForm.jsx` + `Daireler.jsx` detay modalinda 2. araç hakki checkbox (teal). `AksamKontrolu.jsx` gece cetelesinde izinli daireler kutunun alt-sag yarisi **teal** (clip-path ucgen) ile ayristirilir; lejanta eklendi. `analiz.js` gece-cetelesi GET'i `ikinci_arac_izinli` doner.
- **Testler:** `violations.test.js` (2/3 araç sinir), `routes/ikinci_arac.test.js` (CRUD+kota+analiz+cetele), `DaireForm.test.jsx` checkbox. Tum suite yesil (backend 492, frontend 42).

## Gece cetelesi — manuel +/- kaldirildi, tamamen turev (2026-06-20)

**Istek:** Cetele listesindeki elle artir/azalt (+/-) islemleri kalksin. Artik gece boyu arac GIRISI "Elle Plaka Ekle" ekranindan, CIKIS "Bugunun yuklemeleri" gridinden silme ile yapilacak; cetele bunlari OTOMATIK yansitsin. Cetelede daire butonu uzerine gelince (hover/tap) icerideki araclar gorunsun; daire bos/gri ise "Sitede suan arac gorunmuyor" yazsin.
**Cozum:**
- **Cetele artik TAMAMEN TUREV:** sayim `gunluk_kontroller`'den canli hesaplanir. Giris = `POST /kontroller/manuel` (kayit ekler), cikis = `DELETE /kontroller/:id` (kayit siler) → her ikisi de `gunluk_kontroller`'i degistirdiginden cetele GET her acilista guncel. Elle +/- sayim, `manuel` kolonu mantigi ve `?yenile=1` kaldirildi.
- `analiz.js`: `dairBasinaIcerideSayisi` (Map<id,sayi>) → `dairBasinaPlakalar` (Map<id,string[]>) oldu (ayni eslestirme mantigi: kayitli arac + gun-bazli misafir, kayitsiz sayilmaz). `GET /gece-cetelesi` artik `gece_cetelesi` tablosuna YAZMAZ/OKUMAZ; her daire icin `{plakalar, arac_sayisi}` doner. **`PATCH /gece-cetelesi/:daireId` SILINDI.**
- **`gece_cetelesi` tablosu + migration'lari (`20260615/16`) artik kullanilmiyor** (olu; dusurmedik, dusuk risk). Dev script'leri `diag_gece/verify_gece/seed_verify_gece` da bu tabloya bakar — guncel degil.
- Frontend `AksamKontrolu.jsx` `GeceCetelesiModal`: alt +/- paneli kaldirildi → secili daire icin salt-okunur plaka listesi (mobil tap). Daire butonu `title` = icerideki plakalar VEYA bos ise "Sitede suan arac gorunmuyor" (hover). "Aksam tespitinden yenile" → basit "↻ Yenile" (re-fetch). Lejant/renk (0 gri,1 sari,2 kirmizi,3+ koyu) ve 2. arac teal ucgeni korundu.
**Test:** `gece_cetelesi.test.js` bastan yazildi (turev sayim + plakalar + manuel-ekleme girisi + silme cikisi + misafir + ikinci_arac bayragi + 401; PATCH testleri kaldirildi). `ikinci_arac.test.js` cetele GET testi degismedi. (Lokal test DB 5433 kapali → CI'da dogrulanir.)

## Raporlar — Misafir Araç kutusu + Çoklu'dan misafir dusuldu (2026-06-18)

**Istek:** Rapor ozetinde misafir araclar ayri kutu olsun; "Çoklu Araç" (fazla) sayisi misafirleri kapsiyorsa onlari dussun.
**Kok neden:** `ihlaller.plaka_listesi` misafir + kayitli plakayi karisik tutuyordu; hangilerinin misafir oldugu bilinmedigi icin fazla-araç sayisi misafirleri de sayiyordu.
**Cozum:**
- Migration `20260618000001`: `ihlaller.misafir_plaka_listesi jsonb default '[]'`. (Gecmis kayitlar `[]` → geriye donuk misafir kirilimi yok, ileri analiz-et'lerde dolar.)
- `analiz.js`: coklu_arac insert/update'inde `detectViolations`'in dondurdugu `misafir_plakalar` → `misafir_plaka_listesi`'ne yazilir.
- `raporlar.js` dashboard: `ozet.misafir_arac` = SUM(misafir plaka adedi); `coklu_fazla_arac` artik `(toplam - misafir) - hak` (misafir dusulur). `donem_ozet`'e de `misafir_arac` eklendi (Bugün/Bu Hafta/Bu Ay). Hesaplama `daireler` leftJoin + `ikinci_arac_izinli` (izinli 2, normal 1) ile.
- Frontend `RaporlarDashboard.jsx`: 5. kart **Misafir Araç** (emerald); grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. Çoklu kartinin alt yazisi "(misafir hariç)". Dönem Özeti satirina misafir kolonu.
- `emailRaporu.js` degismedi (fazla-araç hesaplamiyor).
**Uyari:** Misafir/çoklu kirilimi yalniz yeni analiz-et cagrilarinda dolar; eski ihlal kayitlarinda misafir 0 gorunur.
**Test:** `routes/raporlar.test.js` (misafir ayrimi + kendi fazla kirilimi), `routes/kontroller.test.js` (analiz-et misafir_plaka_listesi yazimi), `RaporlarDashboard.test.jsx` (Misafir Araç karti) — frontend 7/7 yesil. Backend lokal DB 5433 kapali → CI'da dogrulanir.

## Gece cetelesi — operasyon gunu 08:00'de doner (2026-06-18)

**Istek:** Cetele listesi gece 00:00'da sifirlaniyordu; sifirlama sabah 08:00'e alindi (gece kontrolu suren gorevli 00:30'da bakinca aksamki sayim kaybolmasin).
**Cozum:** `utils/timezone.js` → `ceteleGunuTR()` helper'i: TR saati `CETELE_RESET_SAATI` (08:00) altindaysa bir ONCEKI gunu, degilse takvim gununu doner. `analiz.js` `GET /gece-cetelesi` ve `PATCH /gece-cetelesi/:daireId` varsayilan tarihi `todayTR()` yerine `ceteleGunuTR()` kullaniyor (GET seed + PATCH yazma ayni operasyon gunune dusuyor). `?tarih=` override hala calisir. (GUNCEL 2026-06-18: o gun analiz-et/ihlaller takvim gununde birakilmisti; asagidaki "Kontrol akisi tamamen operasyon gununde" notu ile bu da `ceteleGunuTR`'ye alindi — artik tum kontrol akisi tutarli.)
**Not:** Cetele seed'i `gunluk_kontroller.kontrol_tarihi`'den okur; aksam fotograflari o takvim gununde yuklendiginden 00:00-08:00 arasi ayni tarihi referans alir, sorun yok.
**Test:** `tests/timezone_cetele.test.js` (08:00 sinir birim testi, DB'siz — yesil). `gece_cetelesi.test.js` seed helper'lari `ceteleGunuTR()` ile hizalandi (00:00-08:00 penceresinde kosulsa da gecsin).

## Kontrol akisi tamamen operasyon gununde (2026-06-18)

**Istek:** Kontrol sayfasindaki "Bugunun tum yuklemeleri" listesi de gece 00:00'da sifirlaniyordu (cetele ile ayni dert); sabah 08:00'e kadar dayanmali — gece kontrolu suren gorevli 00:30'da bakinca aksamki yuklemeler kaybolmasin.
**Cozum:** Cetele icin eklenen `ceteleGunuTR()` (08:00 operasyon gunu) artik **tum kontrol akisinda** kullaniliyor:
- `routes/kontroller.js` `GET /` (liste) varsayilan tarihi `todayTR` → `ceteleGunuTR`.
- `routes/kontroller.js` foto-upload + `POST /manuel` insert'lerinde `kontrol_tarihi` `todayTR` → `ceteleGunuTR` (gece yarisindan sonra yuklenen foto da ayni kontrol gunune dusup listede gorunsun).
- `routes/analiz.js` `POST /analiz-et` varsayilan tarihi `todayTR` → `ceteleGunuTR` (upload'larla tutarli; gece yarisini gecen kontrolde yuklemeleri kacirmaz, midnight-spanning tekrar cagrilar ayni `kontrol_tarihi`'ne idempotent duser — `ihlaller` UNIQUE).
**Onemli:** Gece yarisi ONCESI davranis birebir AYNI (`ceteleGunuTR == todayTR` saat >= 08:00 iken). Fark yalniz 00:00-08:00 penceresinde; orada operasyon gunu (bir onceki takvim gunu) dogru referans. `?tarih=`/body `tarih` override'lari korunur. raporlar.js tarih-araligi sorgulari ve foto-temizle retention bu degisiklikten anlamli etkilenmez (birkac saatlik kayma; 1/90 gun esikleri).
**Test:** `kontroller.test.js` + `ikinci_arac.test.js` seed helper'lari `todayTR` → `ceteleGunuTR` ile hizalandi (CI 00:00-08:00 TR penceresinde kossa da seed↔sorgu tutarli). `bildirimler.test.js` explicit `tarih` veriyor (etkilenmez), `multi_tenant_isolation` GET'leri negatif izolasyon assert'i (etkilenmez). (Lokal test DB 5433 kapali → CI'da dogrulanir.)

## Raporlar — fazla arac sayimi 2. arac hakkini bilmiyordu (2026-06-17)

**Sorun:** Dashboard "fazla araç" metrigi (`coklu_fazla_arac`) `jsonb_array_length(plaka_listesi) - 1` ile hesaplaniyordu; muafiyet sabit **1** varsayiliyordu. 2. araç izinli daire 3 araçla ihlal edince fazla **2** sayiliyordu (dogru: 3 - 2 = **1**).
**Kapsam:** `routes/raporlar.js` dashboard'ta 2 yer — `ihlalAgg.coklu_fazla_arac` (donem ozeti kartlari) ve `donemRows`→`donem_ozet` (Bugün/Bu Hafta/Bu Ay). Her ikisi de artik `daireler` leftJoin ile `ikinci_arac_izinli` okuyup muafiyeti `izinli ? 2 : 1` aliyor. leftJoin (inner degil) cunku kayitsiz ihlallerinde `daire_id` NULL.
**Etkilenmeyenler:** Top 10 (`COUNT(*)` ihlal KAYDI) ve `coklu_arac`/`kayitsiz` kayit sayilari zaten dogru — `ihlaller` kayitlari `detectViolations` ile yazilirken kural uygulaniyor (izinli daire ancak 3+ araçta `coklu_arac` kaydi alir). `emailRaporu.js` fazla-araç hesaplamiyor (sadece kayit/plaka sayisi + Top 5 count) → degisiklik gerekmedi.
**Uyari:** Fazla sayisi dairenin GUNCEL `ikinci_arac_izinli` bayragiyla hesaplanir (ihlal aninda snapshot tutulmuyor); bayrak sonradan degisirse gecmis fazla sayisi guncel hakka gore yorumlanir.
**Test:** `routes/raporlar.test.js` — izinli daire 3 araç → fazla 1; normal daire 3 araç → fazla 2; donem_ozet izinli muafiyeti. (Lokal test DB 5433 kapali → CI'da dogrulanir.)

## Misafir gun-ortasi eslesme fix (2026-06-17)

**Sorun:** "Bugunun tum yuklemeleri" listesinde misafir olarak kayitli arac "kayitsiz" gorunuyordu.
**Kok neden:** `routes/kontroller.js` GET `/` misafir join'i `baslangic_tarihi <= tarih` / `bitis_tarihi >= tarih` ile ham `tarih` (YYYY-MM-DD) string'ini kullaniyordu. Kolonlar `timestamptz`; ham tarih gun basini (00:00) baz aldigindan o gun **saat 14:30'da baslayan** misafir kaydi disarda kaliyor → plaka kayitsiz dusuyordu.
**Fix:** `normalizeMisafirZaman(tarih, false/true)` ile gun basi/sonu sinirlari kullanildi (`misafirAraclar.js` GET ile ayni mantik). Artik o gun herhangi bir anda aktif misafir, daire_no + `daire_misafir:true` doner; frontend zaten yesil "B2 · misafir" rozetini gosteriyor (`Kontrol.jsx:612`).
**Aksam kontrolu (analiz-et) — ayni kok neden:** `analiz.js` misafir join'i tek nokta **20:00** referansi (`normalizeMisafirZaman(...T20:00)`) kullaniyordu. Penceresi tam 20:00'i kapsamayan misafir (orn. **20:30'da kaydedilen** ya da gunduz pencereli) `misafirPlakaToDaire`'ye girmiyor → plaka **Kayitsiz Plakalar**'a dusuyordu. Hem `analiz-et` hem `dairBasinaIcerideSayisi` (gece cetelesi tohumu) gun basi/sonu pencereye cevrildi → **misafir muafiyeti artik gun bazli**: o gun herhangi bir anda aktif misafir dairesine sayilir, asla kayitsiz raporlanmaz. (`detectViolations` zaten misafir plakayi kayitsiz saymiyordu; sorun yalniz join penceresiydi.) `referans_zaman` body override artik gun-basi override'i olarak korunuyor (cagiran yok).
**Test:** `routes/kontroller.test.js` — (1) gun-ortasi baslayan misafir listede misafir gosterilir, (2) kayitli plaka misafir DEGIL, (3) 20:30'da baslayan misafir analiz-et'te kayitsiz raporlanmaz + misafir_gorulen'de cikar. (Lokal test DB 5433 kapali → CI'da dogrulanir.)

## OCR Mimari Degisikligi (2026-05-08)

Tesseract.js (taraycida) yerine **Python EasyOCR mikroservisi** kullaniliyor:

- **Eski:** Frontend Tesseract.js + agir post-processing → gercek dunyada %30-40 dogruluk
- **Yeni:** Backend Python servis (`backend/python_ocr/`) FastAPI + EasyOCR + OpenCV → ~%85-92 dogruluk
- Akis: Frontend foto ciker → backend `/kontroller/foto-upload` → R2 + Python OCR paralel → plaka donulur → kullanici onayli/duzeltir
- Frontend `tesseract.js`, `plateOCR.js`, `plateDetector.js` **silindi**
- Yeni env vars: `PYTHON_OCR_URL`, `PYTHON_OCR_TIMEOUT_MS`
- Lokal gelistirme: `docker compose up -d python-ocr` → http://localhost:5000
- Production deploy: Fly.io ayri app `parktrack-ocr`

## Son Durum (2026-06-16)

Aksam kontrolu gercek site fotograflariyla yogun test edildi; OCR/matcher saha-teyitli.

### Gece Cetelesi — manuel sayim (`gece_cetelesi.manuel`)
- Migration `20260616000001` `manuel BOOL default false` ekledi. Backend `analiz.js`:
  - **GET `/gece-cetelesi`:** TUM daireleri hedefler. `manuel=false` satirlar her acilista guncel aksam tespitine **yenilenir** (gec yuklenen fotograflar yansisin; saha bug'i: ilk acilista bayat tohumlu kirmizi daireler gorunmuyordu). `manuel=true` satirlar `WHERE manuel=false` guard ile korunur (gorevlinin elle +/- sayimi silinmez, eszamanli PATCH yarisina guvenli). `?yenile=1` hepsini tespite + `manuel=false` sifirlar.
  - **PATCH `/gece-cetelesi/:daireId`:** her +/- cagrisi `manuel=true` yapar → satir re-seed'e kapanir.

### Frontend — "Son Yuklenenleri Sil" (`Kontrol.jsx silSonBatch`)
- Alt liste (`bugun`) artik **iyimser** olarak sunucu silmelerinden ONCE kaldiriliyor (ust liste gibi) + silmeler **`Promise.allSettled` ile paralel**. Eskiden 89 ardisik `await delete` bitene kadar alt sayac dakikalarca takiliyordu.

### Backend always-warm (Fly: `parktrack-backend`)
- `fly.toml`: `min_machines_running=1` + `auto_stop_machines='suspend'` (eski: `0`/`'stop'`). **Neden:** idle olunca sifira inip her duraklamadan sonraki ilk istek cold-start (5-15s) yiyordu — aksam kontrolunde kabul edilemez. ~$2/ay.
- **App makinesi `90803d24b91487`** (process group `app`). Digerleri (`185d...`, `48ee...` vb.) CRON makineleri — HTTP trafigiyle auto-start OLMAZ. Prod teshis icin ssh'i `--machine 90803d24b91487` ile bu makineye hedefle.

### OCR — iki saha teyidi (2026-06-16)
- **Char-size fix (f32e646) CALISIYOR:** `/big` (en iri bbox) stratejisi hakim; bayi telefonu/yazisi iceren ham metinler dogru plakaya cozuluyor, telefon-olarak-plaka donmuyor.
- **OOM/concurrency fix CALISIYOR:** test batch'i 36 okumada **0 timeout** (06-15'te 19/112'ye karsi). 1-worker + concurrency soft=1 etkili. (PR fallback orani ayri ele alindi → asagi "PR fallback maliyet" bkz.)

### OCR maliyet — zamanli olcekleme (2026-06-16)
- `parktrack-ocr` artik 7/24 acik DEGIL. `min_machines_running=0` + GH Actions cron (`.github/workflows/ocr-schedule.yml`): BASLAT 15:00 UTC / DURDUR 20:00 UTC (18:00–23:00 TR). ~%75 tasarruf (~$40→~$10/ay). 2 makine korundu (yedeklilik + 2 eszamanli). Detay yukarida "Python OCR" bolumunde.

### PR fallback maliyet — kayitli-capali fuzzy'ye guven (2026-06-16, commit a174380)
- **Sorun:** PR (ucretli) `cacheTrusted = score>=95` ile atlaniyordu; fuzzy-registered (60-94) yerel OCR plakayi dogru bulsa bile PR'a gidiyordu (~%56 cagri).
- **Kalibrasyon:** `ocr_metrics.local_match_*` enstrumantasyonu (migration `20260616120000`) ile aksam batch'i olculdu → fuzzy-registered 50/50 **%100 dogru** (snapEligible sayesinde), ~29 PR bosaydi.
- **Fix:** `ocrTrust.js isMatchTrustedForPRSkip` — skor>=95 (her kaynak) VEYA kayitli-capali (`fuzzy-registered`/`raw-registered`) & skor>=80 → PR atla. `fuzzy-learned` HARIC. Enstrumantasyon ACIK kalir → dogruluk izlenir, gerekirse esik ayarlanir.

### Matcher — `snapEligible` (kayitsiz plakayi snap etme, commit 8e3b36e)
- **Sorun:** OCR plakayi DOGRU okusa bile (`34CHF716`) matcher en yakin kayitliya (`34CHF451`, %63) fuzzy snap edip KAYITSIZ araci kayitli daireye gizliyordu → ihlal kacar.
- **Kural (`findBestMatch`):** girdi gecerli tam TR plakasiysa fuzzy snap'e ancak **SERI NO birebir tutarsa VEYA skor ≥85** izin. Seri no aracin asil kimligidir. Cop/parca OCR (tam plaka degil) kisitsiz → eski davranis. `01J0552→34VJ0552` (seri birebir), `34CHF457→34CHF451` (skor 88) korunur; `34CHF716→KAYITSIZ`.
- **DERS:** Matcher en kritik bilesen — **test etmeden deploy etme.** Ilk 2 yaklasim (esik 75; il+harf+seri kurali) bugunun 79 prod okumasina karsi offline replay'de elendi. Kazanan kural yalniz 2 garbled okumayi manuel'e dusurdu (kullanici onayli takas).

### plate_learnings zehir — KAYITLI-hedefli (gate KAPANDI 77ab0d8)
- 9d8a06b gate'i yalniz *kayitsiz* `correct_plaka`'yi engelliyordu. Ham OCR'in bir dairenin DOGRU plakasini okuyup kullanicinin yanlislikla BASKA kayitli plakaya onayladigi satirlar geciyordu (orn `ocr_raw="34AHT610"`/D13 → `34ATL433"`/A23). 2026-06-16'da boyle 7 zehir elle silindi.
- **Fix (77ab0d8):** `recordLearning` artik matcher ile AYNI kurali (`snapEligible`) uygular — `ocr_raw` gecerli tam plakaysa ve `correct_plaka`'ya snap-uygun degilse (seri no farkli + skor<85) ogrenmez. Matcher snap etmiyorsa havuza da girmez; kaynakta onlendi. Cop/parca OCR ve mesru yakin duzeltmeler etkilenmez.
- **Tarama (gecmis zehir icin):** `ocr_raw` normalize edilince kendisi aktif kayitli plaka VE `correct_plaka` ondan farkli kayitli plaka → yuksek-guvenli zehir.

### Prod DB teshis yontemi
- Lokal `.env` localhost'u gosterir (prod DEGIL). App makinesi: `flyctl machine start 90803d24b91487 -a parktrack-backend`, sonra uzun script'i base64 ile gonder: `echo <B64> | base64 -d > /tmp/x.js && node /tmp/x.js`, ssh `--machine 90803d24b91487`. App koku `/app/backend`. `plate_learnings` kolonlari: `ocr_raw, correct_plaka, confirm_count, ...` (raw_ocr DEGIL). site_id prod'da string `"1"`.

## Son Durum (2026-05-08, gun sonu)

Production calisir halde. Asagidakilerin hepsi gercek site fotograflariyla test edildi.

### Calisan Production Konfigurasyonu

**Backend (Fly.io: `parktrack-backend`)**
- `PYTHON_OCR_URL=https://parktrack-ocr.fly.dev` (public URL — `.flycast`/`.internal` Node DNS'inde cozulmedi)
- `PYTHON_OCR_TIMEOUT_MS=20000` (**guncellendi 2026-06-13**, sirasiyla 180000 → 15000 → 20000).
  - **Neden:** Makine always-on, cold-start tamponu gereksiz. OCR ic tarama butcesi 9s (`OCR_TIME_BUDGET_S`, app.py default). 15s denenmisti ama saha testinde (61 foto) 13 timeout cikti — kok neden CPU cekismesiydi (asagi bkz), 20s ek emniyet marji.
- `backend/src/services/pythonOcr.js`: HTTP keep-alive **kapali** (`keepAlive: false`).
  - **Neden:** OCR makinesi restart olunca backend olu TCP soketleri yeniden kullanip timeout suresi boyunca sessizce takiliyordu. Handshake basina 50-200ms kayip, guvenilirlik kazanci yaninda kabul edilebilir.
- Axios hata loglari `err.code`/`err.cause.code`/`err.cause.message` ile detayli (ECONNREFUSED, ENOTFOUND, ETIMEDOUT goruluyor).

**Python OCR (Fly.io: `parktrack-ocr`)**
- **GUNCELLENDI 2026-06-16 — artik 7/24 always-on DEGIL, ZAMANLI:** `min_machines_running = 0`, `auto_stop_machines = 'off'`. Makineler GitHub Actions cron (`.github/workflows/ocr-schedule.yml`) ile yalniz aksam penceresinde acik: BASLAT 15:00 UTC (18:00 TR), DURDUR 20:00 UTC (23:00 TR). 2 makine (`fra`). Asagidaki "always-on" notlari tarihsel — kapasite/OOM gerekceleri hala gecerli ama makineler artik pencere disinda kapali. (Yetkili config: `backend/python_ocr/fly.toml`. Kok dizindeki `fly.python.toml` SILINDI — olu/yanlis isimli `parktrack-python-ocr` hedefliyordu.)
  - **Neden zamanli:** OCR gunde ~1-2 saat (aksam kontrolu) kullaniliyor; 2×4GB 7/24 ~$40/ay idle yaniyordu → ~%75 tasarruf. **Neden eskiden always-on:** Cold start = 35s makine boot + 35s EasyOCR yukleme = 70s; cron 2sa once isittigi icin aksam ilk foto sicak makineye gelir. Cron kacirilirsa `auto_start=true` cold-start ile kurtarir.
- **4GB RAM, 2 CPU, `fra` region, 1 uvicorn worker** (`uvicorn --workers 1`). (**guncellendi 2026-06-15**: 2 worker → 1 worker, OOM nedeniyle; eskiden 2GB/1-worker → 06-13'te 4GB/2-worker → 06-15'te 4GB/1-worker.)
  - **Neden 1 worker (OOM):** Her worker EasyOCR (~800MB) + PaddleOCR yukluyor ≈ 2GB. 2 worker × 2GB + goruntu decode > 4GB → kernel **OOM-kill** (saha 2026-06-15: aksam batch'inde her iki makine de worker'i oldurdu → `connection closed before message completed` = 502 + worker yeniden yuklenirken 20s timeout; 66 fotonun ~10'u boyle dustu). 2 CPU paylasimi yuzunden 2 worker hiz da kazandirmiyordu (06-13 notu).
  - **Kapasite:** 2 makine × 1 worker = **2 eszamanli OCR** = frontend `MAX_CONCURRENT=2` ile birebir. Tek worker 2 CPU'yu tek OCR icin kullanir (per-request daha hizli). Daha fazla paralellik istenirse RAM artir (8GB) ve worker'i geri ac, ya da makine sayisini artir.
  - **Yuk dagitimi (`[http_service.concurrency]` soft=1, hard=2, eklendi 2026-06-15):** Bu ayar YOKKEN Fly varsayilani (soft~20) iki eszamanli istegi AYNI makineye yigip kuyruk 20s timeout'u asiyordu (digeri bos). `soft_limit=1` Fly'i istekleri iki makineye yaymaya zorlar. Saha 22:52 patlamasi (19 Python timeout, hepsi PR ile kurtarildi ama yavas) bu yuzdendi. Hala yetmezse: 3. makine ya da 8GB+2worker+daha cok CPU.
  - **Neden 4GB:** PaddleOCR detection (AGPL-YOLOv8'in yerini aldi — ticari lisans uyumlulugu) + EasyOCR. 1 worker ile bol marj (~$11/ay).
- **Iki katmanli OCR:** Pass 1 region detection + Pass 2 tam-goruntu fallback (max 1000px'e kucultulmus, kalan butce yetmezse atlanir — 30s takilmalarin kaynagiydi). `OCR_TIME_BUDGET_S=9` dolunca eldeki en iyi sonuc donulur.
- **Plate Recognizer fallback:** Yerel OCR dusuk guvenli kalinca `PLATE_RECOGNIZER_API_KEY` ile harici servise gidilir.
- Dockerfile: torch + numpy + easyocr **tek pip resolution pass** ile yukleniyor (`--extra-index-url https://download.pytorch.org/whl/cpu`); paddlepaddle ayri adimda.
  - **Neden:** Onceden torch==2.2.2 ayri pin edilmisti, ardindan numpy 2.x kuruldu → torch numpy 1.x'e karsi build edildigi icin runtime'da "Numpy is not available". Tek pass pip'in uyumlu surumleri secmesini sagliyor.
- EasyOCR weights image build sirasinda pre-download (`~/.EasyOCR`) → ilk request cold-start cezasini odemiyor.

**Foto Servisi (R2)**
- `GET /api/kontroller/:id/foto` artik **S3 SDK kullanmiyor**, R2 public URL'den `fetch` edip stream ediyor.
  - **Neden:** S3 SDK `GetObjectCommand` public erisilebilir dosyalar icin bile `NoSuchKey` doneruyordu (bucket policy / SDK auth tutarsizligi). Public URL fetch hem basit hem guvenilir.

### Plaka Eslestirme + Ogrenme (`backend/src/services/plateMatcher.js`)

Iki katmanli birlesik fuzzy match:

1. **Exact learned match** — Daha once gorulen ham OCR ciktisi varsa, ogrenilen duzeltmeyi anlik dondur (en hizli yol).
2. **Fuzzy match** — Levenshtein benzerlik skoru. Kaynaklar:
   - `araclar` (aktif kayitli plakalar)
   - `misafir_araclar` (bugun gecerli olanlar — `aktif` sutunu **yok**, sadece `baslangic_tarihi <= today <= bitis_tarihi`)
   - `plate_learnings.correct_plaka` (gecmiste onaylanmis plakalar)

`confirm_count` artiyorsa kucuk bir boost (max +5) — cok onaylanmis ogrenmeler tie'larda kazaniyor ama daha iyi bir registered match'i ezemiyor.

**Sonuc:** Bir plaka bir kez duzeltilince, OCR'in ayni plakayi farkli okumalari (orn. `34MN1089` / `34MNI089` / `34MNT089` → `34MNL089`) hepsi otomatik snap oluyor. Sahada dogrulandi.

### Frontend Akis (`frontend/src/pages/Kontrol.jsx`)
- Sunucu tarafli OCR (client-side OCR yok).
- `MAX_CONCURRENT = 2` (**guncellendi 2026-06-13**: 1 → 4 → 2) — 4 denenmisti ama OCR makineleri 2 CPU oldugu icin ayni makineye dusen 2 OCR cekisip 15s timeout asiyordu (saha testi: 61 fotonun 13'u). 2 = makine basina ~1 OCR, cekisme yok, Python ~2-3s'de donuyor.
- Agresiv compression: 0.4MB hedef, 1200px max, 0.7 quality.
- Upload progress yuzdesi.

### Tema (Dark/Light)
- `frontend/src/theme/ThemeContext.jsx` — localStorage `parktrack-tema` + system preference fallback.
- Tailwind `darkMode: 'class'`.
- `index.html`'de inline FOUC-prevention scripti.
- Tum sayfa/component'lerde `dark:` variant'lari.

### Bilinen Davranislar (Bug Degil)
- `/api/kontroller/:id/foto` browser'dan dogrudan acilirsa 401 doner — JWT gerektiriyor, beklenen davranis.
- Service Worker eski cache'i 500 hatasi taklit edebilir → DevTools → Clear site data veya incognito ile dogrulayin.

### Acik Konular
- Mobil hucresel sebekede yavaslik halen olabilir; seri upload ve agresif compression yardimci ama tek tek fotograf 5-15s arasi degisiyor. Toplu upload UX'i (background queue + retry) ileride dusunulebilir.
- Production'da fotograf yukleme akisi gercek site plakalariyla test ediliyor; ogrenme tablosu zamanla site-spesifik OCR pattern'lerine sekilleniyor.

## Guncel Degisiklik Notlari (2026-05-03)

### UI/UX Yeniden Tasarım (2026-05-03)
Frontend görsel iyileştirmeleri tamamlandı:

**1. Tailwind Config (`tailwind.config.js`)**
- Marka renkleri eklendi: `brand` (mavi), `accent` (yeşil)
- Özel animasyonlar: fadeIn, slideUp, slideDown, scaleIn, pulseSoft
- Keyframes tanımları

**2. Global Stiller (`index.css`)**
- Custom scrollbar styling
- Selection renkleri
- Focus visible stilleri
- Utility class'lar: card-hover, gradient-text, glass, skeleton
- Shimmer loading animasyonu

**3. SVG İkonlar (`components/ui/Icons.jsx`) - YENİ**
- Heroicons stilinde 20+ SVG ikon oluşturuldu:
  - BuildingIcon, CarIcon, BadgeIcon, CameraIcon, ChartIcon
  - UsersIcon, ShieldIcon, CheckIcon, XMarkIcon, LockClosedIcon
  - ArrowRightIcon, PlusIcon, TrashIcon, MagnifyingGlassIcon
  - ChevronDownIcon, ArrowPathIcon, ClipboardDocumentIcon
  - DocumentArrowUpIcon, ExclamationTriangleIcon, InformationCircleIcon
  - ParkingIcon, LoadingSpinner

**4. Layout (`components/Layout.jsx`)**
- Gradient header (brand-900 → brand-800)
- Shadow efekti
- Kullanıcı avatarı (ilk harf)
- Admin menüsü ikonlarla güncellendi
- Alt navigation: SVG ikonlar + aktif durum göstergesi
- Smooth transition efektleri

**5. Ana Sayfa (`pages/Home.jsx`)**
- Her kart için özel renk gradyanları
- SVG ikonlar (her kart farklı renk)
- Hover animasyonları (shadow, translate, scale)
- Accordion efekti (sağ ok animasyonu)
- Alt accent çizgisi (hover'da görünür)
- İstatistik kartları (toplam daire, blok sayısı)
- Staggered animation delay

**6. Login Sayfası (`pages/Login.jsx`)**
- Gradient arka plan (brand-50 → brand-100)
- Dekoratif blur daireler
- Büyük logo (20x20, gradient + shadow)
- Gradient text başlık
- Error state için ikonlu kutu
- Loading spinner'lı buton
- Animasyonlar: slideDown, scaleIn

**7. Button Component (`components/ui/Button.jsx`)**
- Yeni varyantlar: primary, secondary, secondaryDark, danger, success, outline, ghost, soft
- Yeni boyutlar: sm, md, lg, xl
- Loading state desteği (LoadingSpinner)
- Gradient butonlar
- Active scale efekti
- Shadow efektleri

**8. Input Component (`components/ui/Input.jsx`)**
- İkon desteği (sol)
- Error ikonu (sağ, ExclamationTriangleIcon)
- Helper text desteği
- Required field göstergesi
- Select ve Textarea component'ları eklendi
- Hover state
- Focus ring efekti

**9. Daireler Sayfası (`pages/Daireler.jsx`)**
- Tablo: Alternating row colors
- Hover efekti (bg-brand-50)
- Seçili satır vurgusu
- Gradient header
- İkonlu filtreler (MagnifyingGlassIcon)
- Detay paneli: Daire badge, styled bilgiler
- Pagination: Bilgi gösterimi + stil
- Empty state: İkon + mesaj
- Bulk import: Styling + icon

**10. Kontrol Sayfası (`pages/Kontrol.jsx`)**
- Status badge'ler (renk kodlu)
- OCR confidence gösterimi
- Durum ikonları (spinner, check, x)
- Büyük görsel preview
- İyileştirilmiş form layout
- Empty state ikonu
- Loading overlay: Backdrop blur, gradient

**11. Toast Bildirimleri (`components/ui/Toast.jsx`)**
- Gradient arka planlar
- İkonlar (success, error, warning, info)
- Kapatma butonu
- Animasyon: slideUp
- Yeni warning tipi

### Backend/API Değişiklikleri

### OCR iyilestirmesi: `frontend/src/services/plateOCR.js` Tesseract.js oncesi fotografi buyutur, gri tona cevirir ve yuksek kontrast varyantini dener; sonra orijinal fotograf fallback olarak denenir. OCR sonucu yine kullanici tarafindan manuel onaylanir/duzeltilir.
- Aksam kontrolu misafir arac kurali: Aktif `misafir_araclar` kayitlari sayimdan dusulmez. Misafir plaka ilgili dairenin sayimina dahil edilir ve sonuc ekraninda plaka yaninda `misafir` etiketiyle gosterilir.
- Kayitsiz plaka kurali: Aktif misafir plaka kayitsiz plaka listesine dusmez. Daha once olusan kayitsiz ihlal kaydi sonraki analizde bosalirsa temizlenir.
- Yeni test kapsami: `backend/tests/violations_guest.test.js` aktif misafir plakanin sayima dahil edildigini ve tek aktif misafir plakanin kayitsiz raporlanmadigini dogrular.

## Teknoloji Stack'i
### Önerilen Yapı (Web Tabanlı - Mobil First)
- **Frontend:** React + Vite + TailwindCSS
- **Backend:** Node.js + Express (PostgreSQL) + Python OCR microservice (OpenCV + Tesseract)
- **Veritabanı:** PostgreSQL (Neon managed)
- **Görsel İşleme:** 
  - Python OCR servisi (OpenCV ile plate detection + Tesseract OCR) - daha yüksek doğruluk
  - Tesseract.js (frontend'de yedek)
- **Kamera:** getUserMedia API
- **Foto Storage:** Cloudflare R2
- **Hosting:** Fly.io (backend), Vercel (frontend)

## Proje Yapısı
parktrack/
├── frontend/
│ ├── src/
│ │ ├── components/
│ │ │ ├── DaireForm.jsx
│ │ │ ├── AracListesi.jsx
│ │ │ ├── FotoYukleme.jsx
│ │ │ ├── IhlalListesi.jsx
│ │ │ └── AramaFiltre.jsx
│ │ ├── pages/
│ │ │ ├── DaireYonetimi.jsx
│ │ │ ├── AracListesi.jsx
│ │ │ ├── GunlukKontrol.jsx
│ │ │ └── Raporlar.jsx
│ │ ├── services/
│ │ │ ├── api.js
│ │ │ ├── plateOCR.js
│ │ │ └── validation.js
│ │ └── utils/
│ │ ├── formatters.js
│ │ └── constants.js
│ └── package.json
├── backend/
│ ├── models/
│ │ ├── Daire.js
│ │ ├── Arac.js
│ │ └── Kontrol.js
│ ├── routes/
│ │ ├── daireler.js
│ │ ├── kontroller.js
│ │ └── raporlar.js
│ └── server.js
└── database/
└── schema.sql

text

## Veritabanı Şeması (SQLite)
```sql
-- Daireler tablosu
CREATE TABLE daireler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daire_no TEXT UNIQUE NOT NULL,
    blok CHAR(1) CHECK(blok IN ('A','B','C','D')),
    sıra_no INTEGER CHECK(sıra_no BETWEEN 1 AND 34),
    sahip_ad TEXT NOT NULL,
    sahip_tel TEXT NOT NULL,
    kayit_zamani DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Araçlar tablosu
CREATE TABLE araclar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daire_id INTEGER NOT NULL,
    plaka TEXT UNIQUE NOT NULL,
    kayit_zamani DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (daire_id) REFERENCES daireler(id)
);

-- Günlük kontroller
CREATE TABLE gunluk_kontroller (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kontrol_tarihi DATE NOT NULL,
    plaka TEXT NOT NULL,
    foto_url TEXT,
    yukleme_zamani DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- İhlaller
CREATE TABLE ihlaller (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kontrol_tarihi DATE NOT NULL,
    daire_no TEXT NOT NULL,
    plaka_sayisi INTEGER,
    ihlal_tipi TEXT
);
API Endpoints
text
GET    /api/daireler              - Tüm daireler
POST   /api/daireler              - Daire ekle
PUT    /api/daireler/:id          - Daire güncelle
DELETE /api/daireler/:id          - Daire sil
GET    /api/araclar/daire/:id     - Dairenin araçları
POST   /api/kontroller/foto-upload     - Fotoğraf yükle
POST   /api/kontroller/analiz-et       - İhlalleri tespit et
GET    /api/kontroller/ihlaller        - İhlalleri listele
Validasyon Kuralları
javascript
// Daire No: A1'den D34'e kadar
const daireNoRegex = /^[A-D]([1-9]|[1-2][0-9]|3[0-4])$/;

// Plaka formatı (basit)
const plakaRegex = /^[0-9]{2}[A-Z]{1,3}[0-9]{2,4}$/;

// Telefon formatı (10 haneli)
const telRegex = /^05[0-9]{9}$/;
Ana Ekranlar
1. Daire/Plaka Tanımlama Formu
Alanlar:

Daire No (dropdown: A1-A34, B1-B34, C1-C34, D1-D34)

Ad Soyad (text input, required)

Telefon (tel input, maskeli, required)

Plaka (text input, required)
Plaka (text input, optional)
Kayıt zamanı (otomatik)

Kurallar:

Aynı plaka farklı daireye kaydedilemez

Bir daireye istenilen kadar araç plakası tanımlanabilir.

2. Tüm Araç Listesi
Özellikler:

Tablo görünümü

Arama kutusu (plaka, ad, daire no)

Blok filtresi (A/B/C/D)

Export butonu (Excel/CSV)

3. Fotoğraf Yükleme (Güvenlik Görevlisi)
Özellikler:

Cep telefonundan kamera ile araç plakası yükleme

Toplu yükleme

Yükleme ilerleme çubuğu

Yüklenen fotoğraf sayacı

4. İhlal Raporu
"Akşam Kontrolünü Tamamla" butonu yapınca:

Hangi dairede 1'den fazla araç var listesi

Kayıtsız araçlar listesi

Raporu göster / dışa aktar

İhlal Tespit Mantığı
javascript
function checkViolations(todayPlates) {
    // 1. Her plaka için hangi daireye ait olduğunu bul
    // 2. Daire bazında plaka sayısını hesapla
    // 3. 1'den fazla plakası olan daireleri listele
    // 4. Kayıtlı olmayan plakaları ayrı listele
    return { ihlalYapanDaireler, kayitsizPlakalar };
}
Mobil Uyumluluk (Çok Önemli)
Mobil first tasarım (güvenlik sahada kullanacak)

Büyük butonlar (min 44x44px)

Kamera direkt açılmalı

Offline çalışabilmeli (PWA)

Hızlı Kurulum Komutları
bash
# Backend (Node.js)
mkdir parktrack && cd parktrack
mkdir backend frontend database
cd backend
npm init -y
npm install express sqlite3 cors multer
npm install -D nodemon

# Frontend (React)
cd ../frontend
npm create vite@latest . -- --template react
npm install axios tailwindcss
Environment Variables
env
PORT=3000
DATABASE_URL=./database/parktrack.db
UPLOAD_DIR=./uploads
MAX_PHOTOS=500
Test Listesi
Yeni daire ekleme

Aynı plakayı 2 daireye ekleme (engellemeli)

Bir daireye 3. plaka ekleme (engellemeli)

Fotoğraf yükleme

Plaka tanıma çalışıyor mu

2+ araç ihlali tespiti

Arama/filtre çalışıyor mu

Rapor çıktısı

Gelecek Geliştirmeler
WhatsApp bildirimi (ihlal olunca)

Aylık istatistik raporları

Otomatik plaka tanıma iyileştirmesi

Önemli Notlar
Veri gizliliğine dikkat et (plaka ve telefonlar)

Günlük otomatik yedekleme yap

Güvenlik görevlisine uygulama eğitimi ver

---

## Uygulama Planı (Fazlar)

### Kararlar (Netleştirildi)
- **Auth:** Rol bazlı — `güvenlik` ve `yönetici` rolleri (JWT + bcrypt)
- **Hosting:** Cloud (internete açık) — **Render** (backend + PostgreSQL), **Vercel** (frontend)
- **Foto storage:** **Cloudflare R2 ZORUNLU** (Render disk ephemeral)
- **OCR GUNCEL:** Tesseract.js kullanilmadan once fotograf buyutulur, gri tona cevrilir ve yuksek kontrast varyanti denenir; kullanici OCR sonucunu yine manuel onaylar/duzeltir.
- **OCR:** Tesseract.js + manuel düzeltme (kullanıcı OCR sonucunu onaylar/düzeltir)
- **Bildirim:** Ekranda liste + WhatsApp otomatik mesaj + ihlal geçmişi/log
  - Mesaj şablonu: *"Dairenize tanımlı birden fazla araç site otoparkında tespit edildi. Lütfen en kısa sürede fazla olan araç/araçları çıkartınız."*
- **DB:** PostgreSQL (Render managed)
- **Backend dili:** Node.js + Express
- **Migration tooling:** Knex.js (SQL migration'lar + seed)
- **Saat dilimi:** `Europe/Istanbul` — backend/DB/frontend her yerde explicit

### Kritik Operasyonel/Yasal Hazırlıklar (Faz'lardan Önce)
Bu maddeler kod yazılmadan paralel başlatılmalı:
1. **WhatsApp Business API başvurusu** — Meta Business Verification (1-3 gün) + mesaj template onayı (`ihlal_bildirimi` template Meta'ya yollanmalı)
2. **KVKK Aydınlatma Metni** — site yönetimi/avukatla hazırlanmalı (plaka + telefon kişisel veri)
3. **R2/S3 hesap açılışı** — Cloudflare R2 hesabı, bucket, API token
4. **Render + Vercel hesap açılışı** — production servisler için ödeme bilgisi
5. **Domain alımı** (opsiyonel ama önerilir, örn `parktrack.site.tr`)

### Rol Yetki Matrisi
| İşlem | Yönetici | Güvenlik |
|---|---|---|
| Daire/araç CRUD | ✅ | ❌ (sadece görüntüleme) |
| Foto yükleme + OCR | ✅ | ✅ |
| Akşam kontrolünü tamamla | ✅ | ✅ |
| İhlal listesi görme | ✅ | ✅ |
| WhatsApp bildirim gönderme | ✅ | ✅ (manuel onayla) |
| Geçmiş raporları + log | ✅ | ✅ (sadece görüntüleme) |
| Kullanıcı yönetimi | ✅ | ❌ |

### Faz 1 — Proje İskeleti & Setup
**Klasör yapısı:**
```
parktrack/
├── backend/         (Node.js + Express + PostgreSQL)
├── frontend/        (React + Vite + TailwindCSS)
├── database/        (knex migrations/ + seeds/)
└── .github/workflows/ (CI/CD pipeline)
```
- `backend/package.json`: express, pg, knex, cors, multer, multer-s3 (R2 için), dotenv, jsonwebtoken, bcrypt, axios, express-rate-limit, helmet, dayjs (timezone)
- `frontend`: Vite + React, Tailwind, axios, react-router-dom, react-hook-form, browser-image-compression (foto sıkıştırma)
- `.env` (DATABASE_URL, JWT_SECRET, WHATSAPP_API_KEY, WHATSAPP_PHONE_ID, R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET, R2_BUCKET, BOOTSTRAP_ADMIN_USER, BOOTSTRAP_ADMIN_PASS, TZ=Europe/Istanbul)
- `.gitignore`, README, `.env.example`
- **Bootstrap admin:** İlk deploy'da `BOOTSTRAP_ADMIN_USER`/`BOOTSTRAP_ADMIN_PASS` env var'ları varsa migration sonrası otomatik yönetici oluştur (chicken-egg çözümü)
- **CI/CD:** `.github/workflows/test.yml` — PR'da Jest + Vitest + Playwright çalıştır
- **CI/CD:** `.github/workflows/deploy.yml` — main'e merge'de Render + Vercel auto-deploy trigger

### Faz 2 — Veritabanı & Backend Çekirdeği
- **Knex migration'ları** (`database/migrations/`): **9 tablo**:
  1. `users` (id, kullanici_adi UNIQUE, sifre_hash, rol ENUM('yonetici','guvenlik'), aktif BOOL, son_giris, olusturma_zamani)
  2. `daireler` — **KVKK alanları eklendi**: + `kvkk_riza BOOL`, `kvkk_riza_tarihi TIMESTAMPTZ`, `bildirim_opt_in BOOL`, `aktif BOOL` (soft delete)
  3. `araclar` — + `aktif BOOL`, `silinme_zamani` (soft delete, geçmiş ihlal kayıtları için)
  4. `gunluk_kontroller` (mevcut + `foto_url` R2 URL'i)
  5. `ihlaller` — `(id, kontrol_tarihi, daire_id FK, daire_no_snapshot, plaka_listesi JSONB, ihlal_tipi, bildirim_id FK, olusturma_zamani)` — UNIQUE(kontrol_tarihi, daire_id) **idempotency için**
  6. `bildirimler` — `(id, ihlal_id FK, daire_no, telefon, mesaj, gonderim_durumu ENUM('beklemede','gonderildi','basarisiz'), deneme_sayisi, gonderim_zamani, hata_mesaji)`
  7. `daire_sahip_tarihce` — **YENİ:** `(id, daire_id FK, sahip_ad, sahip_tel, baslangic_tarihi, bitis_tarihi)` — sahip değişimi tarihçesi
  8. `misafir_araclar` — **YENİ:** `(id, daire_id FK, plaka, baslangic_tarihi, bitis_tarihi, aciklama, ekleyen_user_id FK)` — geçici misafir muafiyeti
  9. `audit_log` — **YENİ:** `(id, user_id FK, eylem, tablo_adi, kayit_id, eski_deger JSONB, yeni_deger JSONB, ip_adres, zaman)` — kim ne yaptı
- **Index'ler:** `araclar(plaka)`, `daireler(daire_no)`, `ihlaller(kontrol_tarihi, daire_id)`, `bildirimler(gonderim_durumu)`
- `backend/db.js`: pg pool + Knex bağlantısı
- `backend/migrations/seed.js`: bootstrap admin (env var'dan), 5-10 örnek daire (sadece development)
- `backend/middleware/auth.js`: JWT doğrula + rol kontrol middleware'i
- `backend/middleware/audit.js`: Otomatik audit log yazma (mutating endpoint'lerde)
- `backend/server.js`: Express + CORS (cloud whitelist) + helmet (güvenlik header'ları) + R2 statik proxy
- `backend/utils/timezone.js`: dayjs `Europe/Istanbul` helper'ları (kontrol_tarihi her yerde TR saatinde)
- **Validasyon middleware'i**: daire no regex, plaka (Türk plaka çeşitliliği: standart + diplomatik CC/CD + askeri + geçici G), telefon
- **Auth endpoint'leri:**
  - `POST /api/auth/login` (kullanici_adi + sifre → JWT, son_giris güncellenir)
  - `POST /api/auth/register` (sadece yönetici)
  - `POST /api/auth/sifre-sifirla` (yönetici başka kullanıcının şifresini sıfırlar)
  - `POST /api/auth/sifre-degistir` (kullanıcı kendi şifresini değiştirir)
  - `GET /api/auth/me`
- **CRUD endpoint'leri** (rol bazlı korumalı):
  - `GET/POST/PUT/DELETE /api/daireler` (POST/PUT/DELETE: yönetici, soft delete)
  - `GET/POST/DELETE /api/araclar` (POST/DELETE: yönetici, soft delete)
  - `POST /api/daireler/:id/sahip-degistir` (eski sahibi tarihçeye taşı, yeni sahip ata)
  - `GET/POST/DELETE /api/misafir-araclar` (geçici muafiyet)
  - `POST /api/daireler/bulk-import` (CSV/Excel toplu yükleme — yönetici)
  - `GET /api/audit-log` (yönetici)
  - **Kritik kural:** Aynı plaka 2 aktif daireye eklenemez (UNIQUE WHERE aktif=true + 409 response)

### Faz 3 — Frontend Çekirdek (Auth + Daire & Araç Yönetimi)
- `App.jsx` + react-router (mobil-first layout, alt navbar, **role-aware**)
- **Login sayfası** (`/login`): kullanıcı adı + şifre, JWT localStorage'a
- **Şifre değiştirme** sayfası (kullanıcı kendi)
- **Kullanıcı yönetimi** (`/kullanicilar`, sadece yönetici): kullanıcı ekle, şifre sıfırla, deaktive et
- `ProtectedRoute` ve `RoleRoute` HOC'ları
- **Sayfa: Daire Yönetimi** (`/daireler`) — sadece yönetici düzenleyebilir
  - DaireForm: blok+sıra dropdown (A1-D34), ad-soyad, telefon (maskeli), plaka(lar)
  - **KVKK aydınlatma metni + açık rıza checkbox'ı (zorunlu)**
  - **WhatsApp bildirim opt-in checkbox'ı (ayrı)** — "İhlal durumunda WhatsApp ile bilgilendirilmeyi kabul ediyorum"
  - Bir daireye birden fazla plaka ekleme, Türkçe hata mesajları, pagination
  - **"Sahip Değiştir" butonu** → eski sahip tarihçeye gider, yeni sahip ataması
  - **"Toplu İçe Aktar" butonu** → CSV/Excel template indir, doldur, yükle
- **Sayfa: Misafir Araç** (`/misafir-araclar`) — geçici muafiyet ekle (plaka + tarih aralığı + açıklama)
- **Sayfa: Araç Listesi** (`/araclar`) — herkes görüntüler
  - Tablo: plaka, daire, sahip, telefon (sayfa başı 50 satır, pagination)
  - Arama (plaka/ad/daire), blok filtresi (A/B/C/D), CSV export (UTF-8 BOM)
- **Sayfa: Audit Log** (`/audit`, sadece yönetici) — kim ne yaptı, tarih filtresi
- `services/api.js` (auth header otomatik, 401 → login redirect), `utils/validation.js`, `utils/constants.js`

### Faz 4 — Fotoğraf Yükleme & OCR
- **Backend:** `POST /api/kontroller/foto-upload`
  - **multer-s3** ile direkt **Cloudflare R2**'ye yükle (Render disk ephemeral, lokal disk YOK)
  - Dosya tipi (jpg/png/webp) + boyut (max 10MB) doğrulaması
  - foto_url R2 public/signed URL olarak döner
- **Frontend:** `/kontrol` sayfası (güvenlik + yönetici)
  - `<input capture="environment">` → telefon kamerası direkt açılır
  - **Foto sıkıştırma client-side** (`browser-image-compression`): 5-10MB jpeg → ~500KB (3G uyumluluk)
  - Toplu yükleme + progress bar + sayaç
  - Yavaş bağlantıda retry + kuyruk
- **OCR:** Tesseract.js client-side plaka okuma
  - OCR oncesi goruntu buyutme + gri ton + yuksek kontrast on islemesi yapilir; basarisiz olursa orijinal fotograf tekrar denenir
  - Lazy load (worker bundle ~10MB, ana sayfada yüklenmesin)
  - Her foto için OCR sonucu input'ta gösterilir → kullanıcı düzeltir → onaylar
  - Türkçe plaka karakter whitelist'i (`0-9 A-Z`)
  - **Plaka format çeşitliliği:** standart (`34ABC123`), diplomatik (`CC`, `CD`), askeri, geçici (`G` prefix) — validator esnek

### Faz 5 — İhlal Tespiti, WhatsApp Bildirim & Rapor
- **Backend:** `POST /api/kontroller/analiz-et`
  - **GUNCEL Misafir arac kurali:** Aktif misafir araclar aksam kontrolune dahil edilir; ilgili dairenin sayimina girer ve sonuc listesinde plaka yaninda `misafir` notu gosterilir. Aktif misafir plakalar kayitsiz plaka listesine dusmez.
  - Bugünkü plakaları al (TR saati ile gün sınırı) → daire bazında grupla
  - **Eski not gecersiz:** Misafir araclar artik sayimdan dusulmez; ilgili dairenin gece sayimina dahil edilir
  - **2 ihlal tipi:** (1) bir daireye 2+ araç, (2) kayıtsız plaka
  - `ihlaller` tablosuna yaz — **idempotent:** UNIQUE(kontrol_tarihi, daire_id) ihlali → mevcut kayıt güncellenir, çift bildirim atılmaz
  - Aynı gün 2. çağrıda sadece **yeni eklenen** ihlaller bildirilir
- **WhatsApp servisi:** `backend/services/whatsapp.js`
  - **WhatsApp Business Cloud API (Meta)** — onaylı `ihlal_bildirimi` template'i kullanılır
  - `POST /api/bildirimler/gonder` — ihlal id alır, **opt-in kontrolü** (`bildirim_opt_in=true` değilse atma)
  - **Retry stratejisi:** Geçici hata (network, 5xx) → exponential backoff 3 deneme; kalıcı hata (invalid number) → tek deneme
  - **Cron worker:** beklemede/başarısız bildirimleri 5dk'da bir retry (max 3 deneme)
  - Gönderim sonucu (success/fail/hata + deneme_sayisi) loglanır
- **Frontend:**
  - **Sayfa: Akşam Kontrolü** (`/kontrol/akşam`)
    - "Akşam Kontrolünü Tamamla" büyük buton
    - **20:00 öncesi uyarı:** "Henüz akşam kontrolü saati gelmedi, devam etmek istiyor musunuz?"
    - **Aynı gün tekrar:** "Bugün için kontrol zaten yapıldı, sadece yeni ihlaller eklenecek"
    - Sonuç ekranı: ihlal listesi (daire + plakalar + telefon + opt-in durumu)
    - Her ihlalin yanında "WhatsApp gönder" butonu (opt-in yoksa pasif + uyarı)
    - Toplu gönder butonu (sadece opt-in'liler)
  - **Sayfa: Raporlar** (`/raporlar`)
    - **İhlal Geçmişi:** tarih aralığı filtresi, daire bazlı gruplama, "X dairesi son 30 günde 3 ihlal yaptı"
    - **Bildirim Logları:** kime/ne zaman/hangi mesaj gönderildi, durum (gönderildi/başarısız/beklemede), deneme sayısı
    - PDF/CSV export (UTF-8 BOM)

### Faz 6 — Mobil, PWA & Bakım Cron'ları
- TailwindCSS responsive (sm/md/lg breakpoints)
- Min 44x44px buton boyutu (güvenlik sahada kullanacak)
- PWA manifest + service worker (offline cache; auth gerekli sayfalar token kontrol)
- Loading state'leri, hata toast'ları (Türkçe)
- Seed script: 5-10 örnek daire/araç + 1 yönetici + 1 güvenlik kullanıcısı
- **Bakım cron'ları** (Render Cron Jobs):
  - Günlük (foto-temizle, GUNCEL 2026-06-13): foto dosyaları **1 gün** sonra R2'den silinir + `foto_url` NULL yapılır (`FOTO_FILE_KEEP_DAYS`); `gunluk_kontroller` DB kayıtları **90 gün** sonra silinir (`FOTO_KEEP_DAYS`) — kontrol geçmişi/raporlar için plaka kayıtları yaşamaya devam eder
  - 5dk'da bir: `bildirimler` tablosunda `gonderim_durumu='beklemede'` olanları retry
  - Haftalık: DB backup export (Neon otomatik yapsa da ek güvenlik)
- **KVKK aydınlatma metni** sayfası (`/kvkk`) — public, login gerektirmez

### Faz 7 — Cloud Deploy, Monitoring & Güvenlik (Fly.io + Neon)
- **Backend:** **Fly.io** (Docker container) + **Neon PostgreSQL** (managed, günlük otomatik backup)
- **Python OCR Service:** **Fly.io** (Docker container) - OpenCV + Tesseract ile gelişmiş plaka tanıma
- **Frontend:** Vercel'e deploy
- **Foto storage:** **Cloudflare R2** (multer-s3 ile) — bucket public read veya signed URL stratejisi
- `fly.toml` konfigürasyonu: web service + env var tanımları
- **Python OCR:** `backend/python_ocr/` dizininde Flask uygulaması, ayrı Fly.io appsi olarak deploy edilir
- HTTPS zorunlu (Fly.io otomatik SSL), CORS whitelist (frontend domain)
- helmet middleware: güvenlik header'ları (CSP, X-Frame-Options vs)
- Rate limiting: login 5/dk, foto upload 50/dk, genel API 100/dk
- Secret yönetimi: `fly secrets set` (tüm sensitive değerler)
- Login brute-force koruma (rate limit + 10 başarısız sonrası 15dk IP lockout)
- WhatsApp API key güvenliği (sadece backend'de)
- **Health check:** `GET /health` (DB ping + R2 ping) + Python OCR `GET /health`
- **Uptime monitoring:** UptimeRobot veya Better Stack ile 5dk'da ping (free tier sleep'i de önler)
- **Error tracking:** Sentry (backend + frontend) — production hataları otomatik raporlanır
- **CI/CD pipeline:**
  - GitHub Actions: PR → test (Jest + Vitest + Playwright) + lint
  - main merge → Fly.io deploy (GitHub Actions) + Vercel auto-deploy
  - DB migration'lar deploy öncesi otomatik (`knex migrate:latest`)
- **Ortam ayrımı:** dev (lokal), staging (Fly.io preview), production (Fly.io main)
- **Python OCR Meta hazırlığı:**
  - OpenCV preprocessing: bilateralFilter, Canny edge, contour detection
  - Tesseract config: `--psm 7` (single text line for plates)
  - Endpoint: `POST /ocr` → plaka döndürür
  - Node.js backend'den `http://python-ocr:5000/ocr` ile çağrılır

---

## Test Planı

### Test Stack'i
- **Backend:** Jest + Supertest (API integration), pg-mem (in-memory PostgreSQL)
- **Frontend:** Vitest + React Testing Library + MSW (API mock)
- **E2E:** Playwright (mobil viewport simülasyonu)
- **CI:** GitHub Actions — her PR'da test çalıştır

### 1. Birim Testler (Backend)
**`utils/validators.test.js`**
- ✅ Geçerli daire no: `A1`, `B34`, `D17` → kabul
- ✅ Geçersiz daire no: `E1`, `A0`, `A35`, `a1`, `A 1` → red
- ✅ Geçerli plaka: `34ABC123`, `06AB1234` → kabul
- ✅ Geçersiz plaka: `34abc123`, `ABC1234`, `34-ABC-123` → red
- ✅ Plaka normalizasyonu: `"34 ABC 123 "` → `"34ABC123"` (boşluk strip + uppercase)
- ✅ Telefon: `05551234567` → kabul; `5551234567`, `90555...` → red

**`utils/auth.test.js`**
- Şifre hash + verify (bcrypt round-trip)
- JWT sign + verify
- Süresi geçmiş JWT reddedilir
- Geçersiz imzalı JWT reddedilir

**`utils/violations.test.js`** (kritik iş mantığı)
- 1 daireye 1 plaka → ihlal yok
- 1 daireye 2 plaka → ihlal var, plaka_listesi doğru
- Aynı plaka 2 kez foto'da → tek say (deduplication)
- Kayıtsız plaka → "kayitsiz" tipinde ihlal
- Boş plaka listesi → ihlal yok, hata yok

**`services/whatsapp.test.js`**
- Mesaj şablonu daire_no ile doğru oluşur
- Telefon formatı +90 prefix ile gönderilir
- API hata response → bildirimler tablosuna `gonderim_durumu='basarisiz'` yazılır

### 2. API Entegrasyon Testleri (Supertest)
**`routes/auth.test.js`**
- ✅ Doğru creds → 200 + JWT
- ✅ Yanlış şifre → 401
- ✅ Olmayan kullanıcı → 401 (timing attack önle: aynı süre)
- ✅ 6 başarısız deneme → 429 (rate limit)
- ✅ `GET /me` token'sız → 401, token ile → 200

**`routes/daireler.test.js`**
- ✅ Yönetici daire ekler → 201
- ✅ Güvenlik daire eklemeye çalışır → 403
- ✅ Geçersiz daire_no → 400
- ✅ Aynı daire_no 2 kez → 409
- ✅ Olmayan daire güncelle → 404

**`routes/araclar.test.js`**
- ✅ Daireye plaka ekle → 201
- ✅ **Aynı plaka 2 farklı daireye → 409** (kritik kural)
- ✅ Daireye N plaka ekle → hepsi kayıtlı (sınır yok)
- ✅ Daire silinince araçları cascade → silinir

**`routes/kontroller.test.js`**
- ✅ Foto upload (multipart) → 200 + foto_url
- ✅ Geçersiz dosya tipi (.exe) → 400
- ✅ 10MB üstü dosya → 413
- ✅ `analiz-et` → ihlal listesi döner, ihlaller tablosuna yazar
- ✅ Aynı gün 2. kez `analiz-et` → idempotent (var olanı update veya 409)

**`routes/bildirimler.test.js`**
- ✅ İhlal id verilince mesaj gönder + log kaydet
- ✅ WhatsApp API down → bildirimler.gonderim_durumu='basarisiz', hata_mesaji dolu
- ✅ Bildirim geçmişi listesi (tarih aralığı filtresi)
- ✅ **Opt-in olmayan daireye gönderme** → atılmaz, 422 + uyarı
- ✅ Retry: 1. deneme fail → 5dk sonra 2. deneme + deneme_sayisi=2

**`routes/misafir-araclar.test.js`** (yeni)
- ✅ Misafir araç ekle → 201
- ✅ Bugünkü ihlal analizi misafir plakayı ilgili dairenin sayımına dahil eder ve misafir olarak notlar
- ✅ Süresi geçmiş misafir kaydı → ihlal sayılır

**`routes/sahip-degistir.test.js`** (yeni)
- ✅ Sahip değişimi → eski sahip `daire_sahip_tarihce`'ye gider, daire güncellenir
- ✅ Geçmiş ihlal raporları eski sahibe atfedilmiş kalır

**`routes/bulk-import.test.js`** (yeni)
- ✅ Geçerli CSV → tüm satırlar kayıt edilir
- ✅ 1 satır geçersiz → o satır skip + hata raporu, diğerleri kayıt
- ✅ Aynı plaka 2 satırda → ikincisi reddedilir
- ✅ Güvenlik rolü → 403

**`routes/audit-log.test.js`** (yeni)
- ✅ Daire güncellemesi audit_log'a yazılır (user_id, eski/yeni değer)
- ✅ Sadece yönetici listeleyebilir

**`routes/auth-sifre.test.js`** (yeni)
- ✅ Yönetici başka kullanıcının şifresini sıfırlar → kullanıcı yeni şifreyle login
- ✅ Güvenlik başkasının şifresini sıfırlamaya çalışır → 403

### 3. Frontend Komponent Testleri (Vitest + RTL)
**`DaireForm.test.jsx`**
- Boş submit → tüm hata mesajları görünür
- Geçersiz plaka → "Plaka formatı yanlış" mesajı
- Çoklu plaka ekleme/silme UI
- Submit success → form sıfırlanır, toast görünür

**`AracListesi.test.jsx`**
- Arama: "B3" yazınca sadece B3 daire araçları kalır
- Blok filtresi: A → sadece A bloku araçları
- CSV export butonu doğru CSV üretir (Türkçe karakter UTF-8 BOM)

**`ProtectedRoute.test.jsx`**
- Token yok → `/login`'e redirect
- Yanlış rol → `/yetkisiz` sayfasına redirect
- Doğru rol → child render

**`PlakaInput.test.jsx`** (OCR sonucu manuel düzeltme)
- OCR sonucu input'a basılır
- Kullanıcı düzeltir, onaylar → state update

### 4. E2E Testler (Playwright, mobil viewport)
**`e2e/full-flow.spec.ts`**
1. Yönetici login
2. Daire ekle (B5, sahip + telefon + 2 plaka)
3. Logout, güvenlik login
4. Foto yükleme sayfasına git, 3 foto yükle (mock OCR)
5. Akşam Kontrolü tamamla
6. İhlal listesinde B5 görünür (2 araç tespiti)
7. WhatsApp gönder butonuna bas → mock servis çağrılır
8. Raporlar → bildirim log'da B5 görünür

**`e2e/auth.spec.ts`**
- Güvenlik kullanıcısı `/daireler` POST yapamaz (UI'da buton görünmez + API 403)

### 5. Manuel Test Listesi (Sahada)
- [ ] Gerçek mobil cihazda (Android/iOS Safari) kamera açılır
- [ ] OCR Türk plakasını okur (5 farklı plaka deneme, doğruluk %)
- [ ] WhatsApp mesajı gerçekten alıcıya ulaşır
- [ ] Yavaş 3G bağlantıda foto upload bozulmaz
- [ ] Offline yüklemeye çalışırken anlamlı hata mesajı
- [ ] PWA "ana ekrana ekle" çalışır
- [ ] 20:00 saati lokal Türkiye saati olarak doğru görünür
- [ ] CSV Excel'de Türkçe karakter bozulmadan açılır

### 6. Yük & Güvenlik Testleri
- [ ] 136 daire + ortalama 2 plaka = 272 araç ile DB performansı (<100ms query)
- [ ] 500 fotoğraf yükleme: backend hafıza/disk dayanıklılığı
- [ ] SQL injection denemesi (plaka alanına `'; DROP TABLE`)
- [ ] XSS denemesi (sahip_ad alanına `<script>`)
- [ ] JWT token tampering → 401
- [ ] Rate limit aşıldığında 429
- [ ] Yetkisiz role escalation: güvenlik token'ı ile `POST /daireler` → 403
