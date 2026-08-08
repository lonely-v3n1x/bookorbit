#!/usr/bin/env bash
#
# Install the BookOrbit daily backup cron job.
#
#   sudo ./install-cron.sh [--hour 3] [--minute 0] [--user root]
#
# Adds a daily crontab entry that runs scripts/backup/backup.sh.
# Safe to re-run: it replaces any existing entry it created before.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="$SCRIPT_DIR/backup.sh"
CRON_USER="${CRON_USER:-$(whoami)}"
HOUR="${BACKUP_HOUR:-3}"
MINUTE="${BACKUP_MINUTE:-0}"

# Parse --hour/--minute/--user args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hour) HOUR="$2"; shift 2 ;;
    --minute) MINUTE="$2"; shift 2 ;;
    --user) CRON_USER="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

chmod +x "$BACKUP_SH"

MARKER="# bookorbit-backup"
CRON_LINE="$MINUTE $HOUR * * * $BACKUP_SH >> $SCRIPT_DIR/backup.log 2>&1 $MARKER"

tmp="$(mktemp)"
if [[ "$CRON_USER" == "$(whoami)" ]]; then
  crontab -l 2>/dev/null | grep -v "$MARKER" > "$tmp" || true
  echo "$CRON_LINE" >> "$tmp"
  crontab "$tmp"
  echo "Installed cron for user $(whoami):"
else
  crontab -u "$CRON_USER" -l 2>/dev/null | grep -v "$MARKER" > "$tmp" || true
  echo "$CRON_LINE" >> "$tmp"
  crontab -u "$CRON_USER" "$tmp"
  echo "Installed cron for user $CRON_USER:"
fi
rm -f "$tmp"

echo "  $CRON_LINE"
echo
echo "Next: verify with 'crontab -l' and do a manual test run:"
echo "  $BACKUP_SH"
echo "A log of each run is written to $SCRIPT_DIR/backup.log"
