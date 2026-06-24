<#
.SYNOPSIS
    Register an hourly Scheduled Task that runs Export-Calendar.ps1.

.DESCRIPTION
    Creates (or replaces) a Scheduled Task "AvailCal Export" that runs the
    exporter hourly in the logged-in user's context (Outlook COM requires an
    interactive profile). The upload target is read from USER environment
    variables at run time, never baked into the task definition:
      - AVAILCAL_AGENT_SAS_URL : the upload URL. For the Cloudflare Worker this
        is https://availcal.<domain>/raw/<Label>.json; for Azure, a SAS URL.
      - AVAILCAL_AGENT_TOKEN   : the Worker's AGENT_TOKEN (Cloudflare only).
    Set them with `setx` BEFORE running this installer so the task inherits them.

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
Write-Output "Ensure these are set as USER environment variables (the task inherits them):"
Write-Output "  AVAILCAL_AGENT_SAS_URL  (Cloudflare Worker /raw/<Label>.json URL, or an Azure SAS URL)"
Write-Output "  AVAILCAL_AGENT_TOKEN    (the Worker AGENT_TOKEN; not needed for Azure)"
if ([string]::IsNullOrWhiteSpace($env:AVAILCAL_AGENT_SAS_URL)) {
    Write-Warning "AVAILCAL_AGENT_SAS_URL is not currently set in this session."
}
Write-Output "Test now with:  Start-ScheduledTask -TaskName '$TaskName'"
