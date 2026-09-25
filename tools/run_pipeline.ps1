# Entry point for the scheduled task. Injects the curator's API key from the
# Proton Pass credential gateway (references in tools/pipeline.env, never
# values), then runs the pipeline and appends everything to logs/pipeline.log.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'pipeline.log'
$gateway = Join-Path $env:USERPROFILE '.claude\skills\credentials-access\scripts\api-keys.ps1'
$envFile = Join-Path $PSScriptRoot 'pipeline.env'

Set-Location $repo
"==== $(Get-Date -Format s) scheduled run ====" | Out-File -FilePath $log -Append -Encoding utf8
if ((Test-Path $gateway) -and (Test-Path $envFile)) {
    & powershell.exe -NoProfile -File $gateway -Reason 'Scheduled coolimages museum curation run' run --env-file $envFile -- python tools\pipeline.py 2>&1 |
        Out-File -FilePath $log -Append -Encoding utf8
} else {
    "No credential env file; running without the curator." | Out-File -FilePath $log -Append -Encoding utf8
    & python tools\pipeline.py --no-curate 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
}
exit $LASTEXITCODE
