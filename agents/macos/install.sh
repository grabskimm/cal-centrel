#!/usr/bin/env bash
# Install the AvailCal macOS launchd agent (hourly).
#
# Usage:
#   ./install.sh /path/to/install/dir
# The install dir should contain export_calendar.py and sources.toml. The SAS
# URL is read from the AVAILCAL_AGENT_SAS_URL env var at install time (prefer an
# Arc Managed Identity where the Mac is Arc-enrolled — see README).
set -euo pipefail

INSTALL_DIR="${1:-$HOME/availcal}"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.availcal.export.plist"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_DST="$LAUNCH_AGENTS/com.availcal.export.plist"
SAS_URL="${AVAILCAL_AGENT_SAS_URL:-}"

if [[ ! -f "$INSTALL_DIR/export_calendar.py" ]]; then
  echo "error: $INSTALL_DIR/export_calendar.py not found." >&2
  echo "Copy export_calendar.py and sources.toml into $INSTALL_DIR first." >&2
  exit 1
fi

if [[ -z "$SAS_URL" ]]; then
  echo "warning: AVAILCAL_AGENT_SAS_URL is empty. The agent will fail to upload" >&2
  echo "until you set it (or switch to a Managed Identity)." >&2
fi

mkdir -p "$LAUNCH_AGENTS"

# Render the plist template with concrete paths + SAS, escaping for sed.
esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
sed -e "s/__INSTALL_DIR__/$(esc "$INSTALL_DIR")/g" \
    -e "s/__SAS_URL__/$(esc "$SAS_URL")/g" \
    "$PLIST_SRC" > "$PLIST_DST"

# Reload.
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Installed launchd agent -> $PLIST_DST (hourly)."
echo "First run happens at load. Watch logs:"
echo "  tail -f $INSTALL_DIR/export.log $INSTALL_DIR/export.err.log"
echo
echo "IMPORTANT: the FIRST run triggers the macOS Calendar (TCC) permission"
echo "prompt. If you don't see it, run a manual --dry-run from Terminal once so"
echo "the prompt appears and you can Allow it:"
echo "  python3 $INSTALL_DIR/export_calendar.py --dry-run --sources-toml $INSTALL_DIR/sources.toml"
