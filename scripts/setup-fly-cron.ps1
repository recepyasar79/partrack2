# Fly.io scheduled machines kurulumu (Faz Ü6) — Windows PowerShell.
#
# Bash karşılığı: scripts/setup-fly-cron.sh
# Detaylı açıklama için ona bakın.

$ErrorActionPreference = 'Stop'
$APP = 'parktrack-backend'
$REGION = 'fra'

$imageJson = flyctl image show -a $APP --json | ConvertFrom-Json
$IMAGE_REF = $imageJson[0].Ref

if (-not $IMAGE_REF) {
  Write-Error "HATA: $APP için deploy edilmiş image bulunamadı. Önce 'flyctl deploy' çalıştırın."
  exit 1
}

Write-Host "Image: $IMAGE_REF"

# Job tanımları: name, schedule, npm-script
$JOBS = @(
  @{ Name = 'data-retention';         Schedule = 'daily';  NpmScript = 'job:data-retention' },
  @{ Name = 'foto-temizle';           Schedule = 'daily';  NpmScript = 'job:foto-temizle' },
  @{ Name = 'parasut-sync';           Schedule = 'daily';  NpmScript = 'job:parasut-sync' },
  @{ Name = 'subscription-lifecycle'; Schedule = 'daily';  NpmScript = 'job:subscription-lifecycle' },
  @{ Name = 'bildirim-retry';         Schedule = 'hourly'; NpmScript = 'job:bildirim-retry' }
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
  flyctl machine run $IMAGE_REF `
    -a $APP `
    --region $REGION `
    --schedule $job.Schedule `
    --name "cron-$($job.Name)" `
    --vm-size shared-cpu-1x `
    --vm-memory 512 `
    --metadata 'fly_process_group=cron' `
    --command 'npm' 'run' $job.NpmScript
}

Write-Host '✓ Cron kurulumu tamam. Liste:'
flyctl machines list -a $APP | Select-String -Pattern 'cron-|NAME'
