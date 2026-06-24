# AvailCal — Windows agent (Outlook COM)

Reads busy intervals from the **already-synced** local Outlook store via the COM
object model and uploads privacy-safe busy JSON to the AvailCal **Cloudflare
Worker** (or, for legacy deployments, Azure Blob). Works for work accounts behind
Conditional Access because it never makes a network calendar call — it reads the
data Outlook has already synced locally.

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

## Upload target

The agent PUTs the busy JSON to a single object path, `/raw/<Label>.json`, where
`<Label>` is this source's one-word label. Pick the method that matches your
deployment.

### Cloudflare Worker (current deployment)

The Worker accepts `PUT https://availcal.<domain>/raw/<Label>.json` with an
`Authorization: Bearer <AGENT_TOKEN>` header (the Worker's `AGENT_TOKEN` secret).
Uploads go to the **private** host (`availcal.<domain>`), never the public one.

- `-SasUrl` / `AVAILCAL_AGENT_SAS_URL` → the Worker URL `https://availcal.<domain>/raw/<Label>.json`
- `-Token` / `AVAILCAL_AGENT_TOKEN` → the Worker's `AGENT_TOKEN`

```powershell
$env:AVAILCAL_AGENT_SAS_URL = "https://availcal.example.com/raw/WorkX.json"
$env:AVAILCAL_AGENT_TOKEN   = "…the worker AGENT_TOKEN…"
.\Export-Calendar.ps1 -SourcesToml .\sources.toml
```

### Azure Blob (legacy)

- **Managed Identity (Arc-enrolled box):** enrol the machine in Azure Arc and
  grant its MI **Storage Blob Data Contributor** on *only* the AvailCal
  container; upload via the MI. No secret on the endpoint.
- **SAS fallback:** a SAS scoped *write-only* to this source's single blob path,
  set as the user env var `AVAILCAL_AGENT_SAS_URL` (token left blank), rotated
  quarterly (see `docs/RUNBOOK.md`).

```powershell
$env:AVAILCAL_AGENT_SAS_URL = "https://acct.blob.core.windows.net/availcal/raw/WorkX.json?sv=...&sig=..."
.\Export-Calendar.ps1 -SourcesToml .\sources.toml
```

The agent auto-detects Azure (it adds the `x-ms-blob-type` header only for
`*.blob.core.windows.net` URLs) vs the Worker (Bearer token), so the same script
serves both.

## Schedule it hourly

Set **both** values as **user** environment variables first (the Scheduled Task
runs in your user context and inherits them), then register the task:

```powershell
setx AVAILCAL_AGENT_SAS_URL "https://availcal.example.com/raw/WorkX.json"
setx AVAILCAL_AGENT_TOKEN   "…AGENT_TOKEN…"
.\Install-Task.ps1 -SourcesToml C:\availcal\sources.toml
```

Registers the **AvailCal Export** Scheduled Task (hourly, interactive user).
Trigger a one-off run with `Start-ScheduledTask -TaskName 'AvailCal Export'`.
(For Azure, set only `AVAILCAL_AGENT_SAS_URL`.)

## The recurrence-sort gotcha (encoded in the script)

`Items.IncludeRecurrences = $true` only expands recurring appointments when the
collection is **sorted first**. The script does `Sort("[Start]")` *then* sets
`IncludeRecurrences` *then* `Restrict(...)`. Reversing the first two silently
drops every recurring instance — do not "tidy" that ordering.

## Fail-loud behaviour

The script exits **non-zero** if Outlook COM won't start or no calendar folder
is found, rather than publishing a falsely-empty "totally free" feed. A genuine
zero-event window logs a warning but is allowed.
