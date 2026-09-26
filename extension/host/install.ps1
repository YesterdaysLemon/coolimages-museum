# Registers the Coolimages Collector helper so the extension can write notes
# (and saves) straight into the coolimages folder, with no download dialogs.
# Per-user only: writes %LOCALAPPDATA%\CoolimagesCollector and one registry
# key per browser under HKCU. Run again after moving the repo.
#
#   powershell -ExecutionPolicy Bypass -File extension\host\install.ps1
#   powershell -ExecutionPolicy Bypass -File extension\host\install.ps1 -Uninstall
param(
  [string]$Folder = (Join-Path $env:USERPROFILE 'OneDrive\Pictures\coolimages'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$name = 'com.coolimages.collector'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:LOCALAPPDATA 'CoolimagesCollector'
# Helium keeps its settings under imput\Helium; Chromium and Chrome are
# registered too in case the browser build looks there.
$roots = 'HKCU:\Software\imput\Helium', 'HKCU:\Software\Chromium', 'HKCU:\Software\Google\Chrome'

if ($Uninstall) {
  foreach ($root in $roots) { Remove-Item -Path "$root\NativeMessagingHosts\$name" -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
  Write-Output 'Coolimages Collector helper removed.'
  exit 0
}

if (-not (Test-Path $Folder)) { throw "Coolimages folder not found: $Folder" }
$id = (Get-Content (Join-Path $here 'extension-id.txt') -Raw).Trim()
New-Item -ItemType Directory -Force $data | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$manifest = [ordered]@{
  name = $name
  description = 'Coolimages Collector helper: writes notes and saves into the coolimages folder'
  path = (Join-Path $here 'collector_host.bat')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
}
$manifestPath = Join-Path $data "$name.json"
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $utf8)
[IO.File]::WriteAllText((Join-Path $data 'config.json'), (@{ folder = (Resolve-Path $Folder).Path } | ConvertTo-Json), $utf8)
foreach ($root in $roots) {
  $key = "$root\NativeMessagingHosts\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}
Write-Output "Coolimages Collector helper registered for extension $id"
Write-Output "Notes and saves go to $((Resolve-Path $Folder).Path)"
