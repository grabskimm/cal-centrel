# AvailCal — Windows agent (Outlook COM)

Reads busy intervals from the **already-synced** local Outlook store via the COM
object model and uploads privacy-safe busy JSON to blob storage. Works for work
accounts behind Conditional Access because it never makes a network calendar
call — it reads the data Outlook has already synced locally.

## Requirements

- Windows with **Outlook desktop** installed and a configured mail profile that
  has synced the calendar at least once.
- PowerShell 5.1+ or PowerShell 7.
- An interactive logon session (Outlook COM cannot run in a pure service
  context).

## What leaves the machine

Only `{source, start, end, status}` per busy block — the single-word source
label plus UTC start/end and a coarse status (`busy`/`tentative`/`oof`). **Free
events are dropped at the source.** No titles, bodies, attendees or locations
are ever read.

## Dry run (no upload)

```powershell
.\Export-Calendar.ps1 -DryRun -SourcesToml .\sources.toml
```

Prints the JSON it *would* upload and a summary line, then exits. Use this to
confirm the recurrence expansion and labels look right before wiring up uploads.

## Auth: Managed Identity preferred, SAS fallback

- **Preferred (Arc-enrolled box):** enrol the machine in Azure Arc and grant its
  managed identity **Storage Blob Data Contributor** on *only* the AvailCal
  container, then upload with `azcopy`/`Az.Storage` using the MI. No secret on
  the endpoint.
- **Fallback (SAS):** generate a SAS scoped to *write-only* on this source's
  single blob path (`/raw/<Label>.json`), set it as the user env var
  `AVAILCAL_AGENT_SAS_URL`, and rotate it quarterly (see `docs/RUNBOOK.md`).

```powershell
$env:AVAILCAL_AGENT_SAS_URL = "https://acct.blob.core.windows.net/availcal/raw/WorkX.json?sv=...&sig=..."
.\Export-Calendar.ps1 -SourcesToml .\sources.toml
```

## Schedule it hourly

```powershell
.\Install-Task.ps1 -SourcesToml C:\availcal\sources.toml
```

Registers the **AvailCal Export** Scheduled Task (hourly, interactive user).
Trigger a one-off run with `Start-ScheduledTask -TaskName 'AvailCal Export'`.

## The recurrence-sort gotcha (encoded in the script)

`Items.IncludeRecurrences = $true` only expands recurring appointments when the
collection is **sorted first**. The script does `Sort("[Start]")` *then* sets
`IncludeRecurrences` *then* `Restrict(...)`. Reversing the first two silently
drops every recurring instance — do not "tidy" that ordering.

## Fail-loud behaviour

The script exits **non-zero** if Outlook COM won't start or no calendar folder
is found, rather than publishing a falsely-empty "totally free" feed. A genuine
zero-event window logs a warning but is allowed.
