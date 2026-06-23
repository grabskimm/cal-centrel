# AvailCal — macOS agent (EventKit)

Reads busy intervals from the **local** macOS calendar store via EventKit and
uploads privacy-safe busy JSON to blob storage. Because it reads the on-device
store, it covers work accounts that sync to Calendar.app even when the server
forbids published ICS.

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

## Auth: Managed Identity preferred, SAS fallback

- **Preferred (Arc-enrolled Mac):** grant the machine's managed identity
  **Storage Blob Data Contributor** on *only* the AvailCal container and upload
  via the MI (no secret on the endpoint).
- **Fallback (SAS):** a write-only SAS scoped to this source's single blob path
  (`/raw/<Label>.json`), exported as `AVAILCAL_AGENT_SAS_URL`, rotated quarterly
  (see `docs/RUNBOOK.md`).

```bash
export AVAILCAL_AGENT_SAS_URL="https://acct.blob.core.windows.net/availcal/raw/Mac.json?sv=...&sig=..."
python3 export_calendar.py --sources-toml ./sources.toml
```

## Schedule it hourly (launchd)

```bash
# Put export_calendar.py + sources.toml in ~/availcal, then:
AVAILCAL_AGENT_SAS_URL="…" ./install.sh ~/availcal
```

This renders `com.availcal.export.plist` with your paths/SAS into
`~/Library/LaunchAgents` and loads it (hourly, runs at load). Logs land in
`~/availcal/export.log` and `export.err.log`; a fail-loud non-zero exit is
recorded in the latter for alerting.
