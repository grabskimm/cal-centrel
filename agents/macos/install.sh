#!/usr/bin/env bash
# Install the AvailCal macOS launchd agent (hourly).
#
# Usage:
#   AVAILCAL_AGENT_SAS_URL="https://availcal.<domain>/raw/<Label>.json" \
#   AVAILCAL_AGENT_TOKEN="<worker AGENT_TOKEN>" \
#   ./install.sh /path/to/install/dir
#
# The install dir should contain export_calendar.py and sources.toml. Both the
# upload URL (AVAILCAL_AGENT_SAS_URL) and, for the Cloudflare Worker, the Bearer
# token (AVAILCAL_AGENT_TOKEN) are read from the environment at install time and
# baked into the launchd plist (launchd does not inherit your shell env).
# For the Cloudflare deployment the URL is the Worker endpoint
# https://availcal.<domain>/raw/<Label>.json; for Azure it's a write-scoped SAS
# URL and the token is left blank.
set -euo pipefail

INSTALL_DIR="${1:-$HOME/availcal}"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.availcal.export.plist"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_DST="$LAUNCH_AGENTS/com.availcal.export.plist"
SAS_URL="${AVAILCAL_AGENT_SAS_URL:-}"
TOKEN="${AVAILCAL_AGENT_TOKEN:-}"

if [[ ! -f "$INSTALL_DIR/export_calendar.py" ]]; then
  echo "error: $INSTALL_DIR/export_calendar.py not found." >&2
  echo "Copy export_calendar.py and sources.toml into $INSTALL_DIR first." >&2
  exit 1
fi

if [[ -z "$SAS_URL" ]]; then
  echo "warning: AVAILCAL_AGENT_SAS_URL is empty. The agent will fail to upload" >&2
  echo "until you set it (the Cloudflare Worker /raw/<Label>.json URL, an Azure" >&2
  echo "SAS URL, or switch to a Managed Identity)." >&2
fi

# For the Cloudflare Worker, the Bearer token is required.
if [[ "$SAS_URL" == *"/raw/"* && "$SAS_URL" != *"blob.core.windows.net"* && -z "$TOKEN" ]]; then
  echo "warning: the URL looks like the Cloudflare Worker endpoint but" >&2
  echo "AVAILCAL_AGENT_TOKEN is empty — uploads will 401. Set it to the Worker's" >&2
  echo "AGENT_TOKEN." >&2
fi

mkdir -p "$LAUNCH_AGENTS"

# Render the plist template with concrete paths + upload URL + token (escaped).
esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
sed -e "s/__INSTALL_DIR__/$(esc "$INSTALL_DIR")/g" \
    -e "s/__SAS_URL__/$(esc "$SAS_URL")/g" \
    -e "s/__TOKEN__/$(esc "$TOKEN")/g" \
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
