# Entry point for the scheduled task: rebuild and publish images, then let
# GitHub Actions curate them (see tools/pipeline.py). No credentials are
# needed here beyond the existing SSH key and gh login.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'pipeline.log'

Set-Location $repo
"==== $(Get-Date -Format s) scheduled run ====" | Out-File -FilePath $log -Append -Encoding utf8
& python tools\pipeline.py 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
