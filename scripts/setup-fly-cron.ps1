# Fly.io scheduled machines kurulumu (Faz Ü6) — Windows PowerShell.
#
# Bash karşılığı: scripts/setup-fly-cron.sh
# Detaylı açıklama için ona bakın.

$ErrorActionPreference = 'Stop'
$APP = 'parktrack-backend'
$REGION = 'fra'

# En yeni deployment'ı bul: cron makineleri eski image'da takılı kalmasın.
# Tag formatı ULID (`deployment-<ULID>`) — leksikografik sırada zaman sırasına
# uyar. Sort -Descending ile en güncel olanı seçeriz.
$imageJson = flyctl image show -a $APP --json | ConvertFrom-Json
$latest = $imageJson | Sort-Object Tag -Descending | Select-Object -First 1
if (-not $latest -or -not $latest.Registry) {
  Write-Error "HATA: $APP için deploy edilmiş image bulunamadı. Önce 'flyctl deploy' çalıştırın."
  exit 1
}
$IMAGE_REF = "$($latest.Registry)/$($latest.Repository):$($latest.Tag)"

Write-Host "Image: $IMAGE_REF"

# Job tanımları: name, schedule, npm-script
$JOBS = @(
  @{ Name = 'data-retention';         Schedule = 'daily';  NpmScript = 'job:data-retention' },
  @{ Name = 'foto-temizle';           Schedule = 'daily';  NpmScript = 'job:foto-temizle' },
  @{ Name = 'parasut-sync';           Schedule = 'daily';  NpmScript = 'job:parasut-sync' },
  @{ Name = 'subscription-lifecycle'; Schedule = 'daily';  NpmScript = 'job:subscription-lifecycle' },
  @{ Name = 'email-raporu';           Schedule = 'daily';  NpmScript = 'job:email-raporu' },
  @{ Name = 'bildirim-retry';         Schedule = 'hourly'; NpmScript = 'job:bildirim-retry' },
  @{ Name = 'zehirli-ogrenme-temizle'; Schedule = 'weekly'; NpmScript = 'job:zehirli-ogrenme-temizle' }
)

# Eski scheduled machines'i temizle
Write-Host 'Eski cron makineleri taranıyor...'
$machinesJson = flyctl machines list -a $APP --json | ConvertFrom-Json
$existing = $machinesJson | Where-Object { $_.config.metadata.fly_process_group -eq 'cron' }
foreach ($m in $existing) {
  Write-Host "  destroy: $($m.id)"
  flyctl machine destroy -a $APP --force $m.id
}

foreach ($job in $JOBS) {
  Write-Host "Schedule: $($job.Name) ($($job.Schedule)) → npm run $($job.NpmScript)"
  # Komutu positional args olarak ver: --command tek string aliyor;
  # `--command 'npm' 'run' $script` PS'de 'run' ve script'i positional
  # arg yapiyor, flyctl --command'i ezerek CMD=["run", $script] kuruyor
  # → docker-entrypoint "run" sistem komutu olmadigi icin `node run`
  # prepend ediyor → MODULE_NOT_FOUND. `--` separator + positional ile
  # CMD=["npm","run",$script] dogru kurulur.
  flyctl machine run $IMAGE_REF `
    -a $APP `
    --region $REGION `
    --schedule $job.Schedule `
    --name "cron-$($job.Name)" `
    --vm-size shared-cpu-1x `
    --vm-memory 512 `
    --metadata 'fly_process_group=cron' `
    -- npm run $($job.NpmScript)
}

Write-Host '✓ Cron kurulumu tamam. Liste:'
flyctl machines list -a $APP | Select-String -Pattern 'cron-|NAME'
