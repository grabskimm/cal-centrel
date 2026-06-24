# AvailCal — macOS agent (EventKit)

Reads busy intervals from the **local** macOS calendar store via EventKit and
uploads privacy-safe busy JSON to the AvailCal **Cloudflare Worker** (or, for
legacy deployments, Azure Blob). Because it reads the on-device store, it covers
work accounts that sync to Calendar.app even when the server forbids published
ICS.

## Requirements

- macOS **14+** (uses the `requestFullAccessToEventsWithCompletion:` API).
- Python 3 with PyObjC EventKit bindings:
  ```bash
  python3 -m pip install pyobjc-framework-EventKit
  ```

## What leaves the machine

Only `{source, start, end, status}` per busy block (single-word label + UTC
start/end + coarse status). **Free events are dropped at the source.** No event
titles, notes, attendees or locations are ever read.

## Grant calendar access (TCC) — required, fail-loud

macOS gates calendar reads behind **TCC** (Transparency, Consent & Control). An
app without permission gets **zero events with no error** — which is exactly the
silent failure that would publish a false "I'm totally free" feed. This agent
therefore checks the authorization state and **exits non-zero** unless full
access is granted.

First-run grant:

1. Run a dry run from Terminal so the prompt appears:
   ```bash
   python3 export_calendar.py --dry-run --sources-toml ./sources.toml
   ```
2. Click **Allow** (or **OK**) on the "… would like to access your Calendar"
   prompt.
3. Verify in **System Settings → Privacy & Security → Calendars** that your
   terminal/Python (and later the launchd agent) is toggled **on**. With "Full
   Access" if offered.

If you ever see `full calendar access NOT granted (authorization status=…)`,
re-do the toggle above; the agent will refuse to upload until access is real.

## Dry run (no upload)

```bash
python3 export_calendar.py --dry-run --sources-toml ./sources.toml
```

Prints the JSON it would upload plus a summary, and exits 0.

## Upload target

The agent PUTs the busy JSON to a single object path, `/raw/<Label>.json`, where
`<Label>` is this source's one-word label. Pick the method that matches your
deployment.

### Cloudflare Worker (current deployment)

The Worker accepts `PUT https://availcal.<domain>/raw/<Label>.json` with an
`Authorization: Bearer <AGENT_TOKEN>` header (the Worker's `AGENT_TOKEN` secret).
Uploads go to the **private** host (`availcal.<domain>`), never the public one.

- `--sas-url` / `AVAILCAL_AGENT_SAS_URL` → the Worker URL `https://availcal.<domain>/raw/<Label>.json`
- `--token` / `AVAILCAL_AGENT_TOKEN` → the Worker's `AGENT_TOKEN`

```bash
export AVAILCAL_AGENT_SAS_URL="https://availcal.example.com/raw/Mac.json"
export AVAILCAL_AGENT_TOKEN="…the worker AGENT_TOKEN…"
python3 export_calendar.py --sources-toml ./sources.toml
```

### Azure Blob (legacy)

- **Managed Identity (Arc-enrolled Mac):** grant the machine's MI **Storage Blob
  Data Contributor** on *only* the AvailCal container (no secret on the endpoint).
- **SAS fallback:** a write-only SAS scoped to this source's single blob path,
  exported as `AVAILCAL_AGENT_SAS_URL` (token left blank), rotated quarterly
  (see `docs/RUNBOOK.md`).

```bash
export AVAILCAL_AGENT_SAS_URL="https://acct.blob.core.windows.net/availcal/raw/Mac.json?sv=...&sig=..."
python3 export_calendar.py --sources-toml ./sources.toml
```

The agent auto-detects Azure (it adds the `x-ms-blob-type` header only for
`*.blob.core.windows.net` URLs) vs the Worker (Bearer token), so the same script
serves both.

## Schedule it hourly (launchd)

```bash
# Put export_calendar.py + sources.toml in ~/availcal, then (Cloudflare):
AVAILCAL_AGENT_SAS_URL="https://availcal.example.com/raw/Mac.json" \
AVAILCAL_AGENT_TOKEN="…AGENT_TOKEN…" \
./install.sh ~/availcal
```

This renders `com.availcal.export.plist` with your paths + upload URL + token
into `~/Library/LaunchAgents` and loads it (hourly, runs at load). **launchd does
not inherit your shell env**, so the URL and token are baked into the plist's
`EnvironmentVariables` at install time. Logs land in `~/availcal/export.log` and
`export.err.log`; a fail-loud non-zero exit is recorded in the latter for
alerting.
