#!/usr/bin/env bash
# Fly.io scheduled machines kurulumu (Faz Ü6).
#
# Her cron job ayrı bir ephemeral machine olarak çalışır — Fly otomatik
# tetikler, iş biter, machine kapanır. Schedule seçenekleri:
#   hourly, daily, weekly, monthly
#
# Bu script idempotent: yeniden çalıştırılırsa eski scheduled machines'i
# bulup günceller (önce listele, varsa destroy, sonra yeniden create).
#
# Kullanım:
#   ./scripts/setup-fly-cron.sh
#
# Önkoşul:
#   - flyctl auth login (kullanıcı oturumu)
#   - fly.toml ile bağlı parktrack-backend app (deploy edilmiş image)
#
# Region: fra (app'in primary_region'u ile aynı).

set -euo pipefail

APP=parktrack-backend
REGION=fra
# En yeni deployment'ı bul: cron makineleri eski image'da takılı kalmasın.
# Tag formatı ULID (`deployment-<ULID>`) — leksikografik sırada zaman sırasına
# uyar. Max ile en güncel olanı seçeriz.
IMAGE_JSON=$(flyctl image show -a "$APP" --json 2>/dev/null || echo "[]")
IMAGE_REF=$(echo "$IMAGE_JSON" | jq -r 'sort_by(.Tag) | last | (.Registry + "/" + .Repository + ":" + .Tag)' 2>/dev/null || echo "")

if [ -z "$IMAGE_REF" ] || [ "$IMAGE_REF" = "null" ] || [ "$IMAGE_REF" = "/:" ]; then
  echo "HATA: $APP için deploy edilmiş image bulunamadı. Önce 'flyctl deploy' çalıştırın."
  exit 1
fi

echo "Image: $IMAGE_REF"

# Job tanımları: name | schedule | npm-script
JOBS=(
  "data-retention|daily|job:data-retention"
  "foto-temizle|daily|job:foto-temizle"
  "parasut-sync|daily|job:parasut-sync"
  "subscription-lifecycle|daily|job:subscription-lifecycle"
  "email-raporu|daily|job:email-raporu"
  "bildirim-retry|hourly|job:bildirim-retry"
  "zehirli-ogrenme-temizle|weekly|job:zehirli-ogrenme-temizle"
  "ocr-saglik|hourly|job:ocr-saglik"
)

# Eski scheduled machines'i temizle (idempotency)
echo "Eski cron makineleri taranıyor..."
EXISTING=$(flyctl machines list -a "$APP" --json | jq -r '.[] | select(.config.metadata.fly_process_group=="cron") | .id' || true)
if [ -n "$EXISTING" ]; then
  for ID in $EXISTING; do
    echo "  destroy: $ID"
    flyctl machine destroy -a "$APP" --force "$ID" || true
  done
fi

# Her job için yeni scheduled machine oluştur
for ENTRY in "${JOBS[@]}"; do
  IFS='|' read -r NAME SCHEDULE NPM_SCRIPT <<< "$ENTRY"
  echo "Schedule: $NAME ($SCHEDULE) → npm run $NPM_SCRIPT"
  # Komutu positional args olarak ver: --command tek string alıyor;
  # `--command "npm" "run" $NPM` bash'te "run" ve script'i positional
  # arg yapıyor, flyctl --command'i ezerek CMD=["run", $NPM] kuruyor →
  # docker-entrypoint "run" sistem komutu olmadığı için `node run`
  # prepend ediyor → MODULE_NOT_FOUND. `--` separator + positional ile
  # CMD=["npm","run",$NPM] doğru kurulur.
  flyctl machine run "$IMAGE_REF" \
    -a "$APP" \
    --region "$REGION" \
    --schedule "$SCHEDULE" \
    --name "cron-$NAME" \
    --vm-size shared-cpu-1x \
    --vm-memory 512 \
    --metadata "fly_process_group=cron" \
    -- npm run "$NPM_SCRIPT"
done

echo "✓ Cron kurulumu tamam. Liste:"
flyctl machines list -a "$APP" | grep -E "cron-|NAME"
