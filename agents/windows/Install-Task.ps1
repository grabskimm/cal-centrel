<#
.SYNOPSIS
    Register an hourly Scheduled Task that runs Export-Calendar.ps1.

.DESCRIPTION
    Creates (or replaces) a Scheduled Task "AvailCal Export" that runs the
    exporter hourly in the logged-in user's context (Outlook COM requires an
    interactive profile). The SAS URL is read from the AVAILCAL_AGENT_SAS_URL
    user environment variable so it is never baked into the task definition.

.PARAMETER SourcesToml
    Path to sources.toml passed through to the exporter.

.PARAMETER TaskName
    Scheduled Task name (default "AvailCal Export").

.EXAMPLE
    .\Install-Task.ps1 -SourcesToml C:\availcal\sources.toml
#>
[CmdletBinding()]
param(
    [string]$SourcesToml = "$PSScriptRoot\sources.toml",
    [string]$TaskName = "AvailCal Export"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "Export-Calendar.ps1"
if (-not (Test-Path $script)) { throw "Export-Calendar.ps1 not found next to this installer." }

$psExe = (Get-Command powershell.exe).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -SourcesToml `"$SourcesToml`""

$action = New-ScheduledTaskAction -Execute $psExe -Argument $arguments

# Hourly, indefinitely, starting at the next round hour.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours((Get-Date).Hour + 1) `
    -RepetitionInterval (New-TimeSpan -Hours 1)

# Run as the current interactive user (needed for Outlook COM). Only when logged on.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered scheduled task '$TaskName' (hourly)."
Write-Output "Ensure AVAILCAL_AGENT_SAS_URL is set as a USER environment variable."
Write-Output "Test now with:  Start-ScheduledTask -TaskName '$TaskName'"
