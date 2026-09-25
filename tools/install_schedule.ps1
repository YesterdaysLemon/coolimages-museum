# Registers (or updates) the "Coolimages Museum Pipeline" task: every two days
# at 11:00, catching up after missed runs, only while this user is signed in
# (the credential gateway and OneDrive folder belong to the interactive user).
param(
    [string]$Time = '11:00',
    [int]$EveryDays = 2
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'run_pipeline.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
    -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval $EveryDays -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Coolimages Museum Pipeline' -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description 'Curate new saved images and publish them to coolimages.alirezaafshan.com' -Force |
    Select-Object TaskName, State
