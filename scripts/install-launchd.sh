#!/bin/sh
# Install the web server and the hourly maintenance job as launchd agents.
#
# macOS keeps background processes out of ~/Documents, so the app is copied to
# <data dir>/app and runs from there. Run this again after changing the code.
# Remove the agents with: scripts/install-launchd.sh --remove
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DATA_DIR="$(sed -n 's/^ASOM_DATA_DIR=//p' "$REPO/.env" 2>/dev/null | tail -1)"
DATA_DIR="${DATA_DIR:-$HOME/.astudyonmyself}"
DATA_DIR="$(eval echo "$DATA_DIR")"
APP="$DATA_DIR/app"
DOMAIN="gui/$(id -u)"
NODE="$(command -v node)"

for name in server maintain; do
  launchctl bootout "$DOMAIN" "$AGENTS/com.astudyonmyself.$name.plist" 2>/dev/null || true
done
if [ "${1:-}" = "--remove" ]; then
  rm -f "$AGENTS"/com.astudyonmyself.*.plist
  echo "Removed."
  exit 0
fi

mkdir -p "$AGENTS" "$DATA_DIR/logs" "$APP"
rsync -a --delete "$REPO/server" "$REPO/scripts" "$REPO/static" "$REPO/site" "$REPO/analysis" "$REPO/package.json" "$APP/"
[ -f "$REPO/.env" ] && install -m 600 "$REPO/.env" "$APP/.env"
for name in server maintain; do
  sed -e "s|@APP@|$APP|g" -e "s|@LOGS@|$DATA_DIR/logs|g" -e "s|@NODE@|$NODE|g" \
    "$REPO/scripts/launchd/com.astudyonmyself.$name.plist" > "$AGENTS/com.astudyonmyself.$name.plist"
  launchctl bootstrap "$DOMAIN" "$AGENTS/com.astudyonmyself.$name.plist"
done
echo "Installed from $APP. Server on http://127.0.0.1:8000; maintenance runs hourly. Logs in $DATA_DIR/logs."
