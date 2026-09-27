# Writes the Cadence Supabase URL and PUBLISHABLE key into the local,
# gitignored .env without printing the key.
#
# 1. Supabase dashboard -> Cadence Martial Arts -> Settings -> API Keys
# 2. Click "Copy" on the Publishable key row (NOT a secret key)
# 3. powershell -ExecutionPolicy Bypass -File scripts/set-supabase-env.ps1
#
# Refuses anything that is not a publishable key, so a secret key can never
# be written into the mobile app by mistake.

$ErrorActionPreference = 'Stop'
$projectRef = 'rxoeyyiiwgnyjdtjouwy'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

$key = (Get-Clipboard -Raw)
if ($null -eq $key) { $key = '' }
$key = $key.Trim()

if ($key -like 'sb_secret_*' -or $key -match 'service_role') {
  Set-Clipboard -Value ' '
  Write-Error 'That is a SECRET key. It must never go into the mobile app. Clipboard cleared; nothing written.'
}
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$') {
  Write-Error 'Clipboard does not hold a publishable key (sb_publishable_...). Nothing written.'
}

$musicUrl = 'http://localhost:8787'
if (Test-Path $envPath) {
  $existing = Get-Content $envPath | Where-Object { $_ -match '^EXPO_PUBLIC_MUSIC_SERVICE_URL=' }
  if ($existing) { $musicUrl = ($existing -split '=', 2)[1] }
}

$lines = @(
  "EXPO_PUBLIC_SUPABASE_URL=https://$projectRef.supabase.co",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$key",
  "EXPO_PUBLIC_MUSIC_SERVICE_URL=$musicUrl",
  'EXPO_PUBLIC_APP_ENV=development'
)
[System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n")
Set-Clipboard -Value ' '
Write-Output "Wrote $envPath for project $projectRef (key length $($key.Length)). Clipboard cleared."
