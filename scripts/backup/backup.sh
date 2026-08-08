#!/usr/bin/env bash
#
# BookOrbit automatic backup -> Google Drive (via rclone)
#
#   Daily:  Postgres dump (metadata, progress, users, shelves) + .env
#   Weekly: full archive of books + app data (covers etc.)
#
# Retention is enforced locally AND on Google Drive so the free 15 GB
# does not fill up. Everything is configurable through environment
# variables (defaults shown) — set them in a small cron wrapper or
# export them before running.
#
set -euo pipefail

# --- Configuration (override via environment) ---------------------------------
BOOKORBIT_DIR="${BOOKORBIT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$BOOKORBIT_DIR/backups}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_PATH="${RCLONE_PATH:-bookorbit-backups}"
DB_CONTAINER="${DB_CONTAINER:-bookorbit-db}"
KEEP_DAILY="${KEEP_DAILY:-14}"     # Postgres dumps kept (days)
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"     # full book archives kept (weeks)
WEEKLY_WEEKDAY="${WEEKLY_WEEKDAY:-0}" # 0 = Sunday

TODAY="$(date +%Y%m%d)"
DAILY_DIR="$BACKUP_DIR/daily"
WEEKLY_DIR="$BACKUP_DIR/weekly"

log() { echo "[backup $(date '+%F %T')] $*"; }

# --- Read database credentials from .env (used for the dump) -------------------
# Parse only the two keys we need instead of sourcing the file: values in
# .env can contain shell metacharacters ($, backticks, spaces) that would be
# expanded/executed by `source`, and we never want to run .env as code.
env_val() { grep -E "^$1=" "$BOOKORBIT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'; }
POSTGRES_USER="${POSTGRES_USER:-$(env_val POSTGRES_USER)}"
POSTGRES_DB="${POSTGRES_DB:-$(env_val POSTGRES_DB)}"
: "${POSTGRES_USER:?POSTGRES_USER not found in .env}"
: "${POSTGRES_DB:?POSTGRES_DB not found in .env}"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

# --- 1. Daily Postgres dump ----------------------------------------------------
DB_DUMP="$DAILY_DIR/bookorbit-$TODAY.sql.gz"
log "Dumping Postgres database '$POSTGRES_DB'..."
if ! docker compose --project-directory "$BOOKORBIT_DIR" \
  -f "$BOOKORBIT_DIR/docker-compose.yml" \
  exec -T "$DB_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip -9 > "$DB_DUMP"; then
  log "ERROR: pg_dump failed — deleting partial dump"
  rm -f "$DB_DUMP"
  exit 1
fi
# Abort if the dump is empty or corrupt — never upload a broken backup.
if ! [[ -s "$DB_DUMP" ]] || ! gzip -t "$DB_DUMP" 2>/dev/null; then
  log "ERROR: database dump is empty or corrupt — deleting it"
  rm -f "$DB_DUMP"
  exit 1
fi
log "Database dump written: $(du -h "$DB_DUMP" | cut -f1)"

# .env holds JWT/DB secrets — back it up alongside (it lives only on this server)
if [[ -f "$BOOKORBIT_DIR/.env" ]]; then
  cp "$BOOKORBIT_DIR/.env" "$DAILY_DIR/.env"
fi

# --- 2. Weekly full archive (books + app data) --------------------------------
WEEKDAY_NOW="$(date +%u)" # 1=Mon .. 7=Sun; 0 in config means Sunday (7)
WEEKLY_DAY=$((WEEKLY_WEEKDAY == 0 ? 7 : WEEKLY_WEEKDAY))
# Archive on the configured weekday, or on the very first run ever (bootstrap).
HAS_WEEKLY_ANY="$(ls -1 "$WEEKLY_DIR" 2>/dev/null | grep -cE 'bookorbit-[0-9]{8}-full.tar.gz' || true)"
if [[ "$WEEKDAY_NOW" == "$WEEKLY_DAY" ]] || [[ "$HAS_WEEKLY_ANY" == "0" ]]; then
  ARCHIVE="$WEEKLY_DIR/bookorbit-$TODAY-full.tar.gz"
  log "Creating weekly archive of books + app data..."
  # Archive with stable paths (books/, data/app/) so restores are predictable.
  pushd "$BOOKORBIT_DIR" >/dev/null
  TAR_ARGS=()
  [[ -d "${BOOKS_HOST_PATH:-./books}" ]] && TAR_ARGS+=( "${BOOKS_HOST_PATH:-./books}" )
  [[ -d "./data/app" ]] && TAR_ARGS+=( "./data/app" )
  if [[ ${#TAR_ARGS[@]} -gt 0 ]]; then
    tar -czf "$ARCHIVE" --exclude='*.tmp' "${TAR_ARGS[@]}"
    log "Weekly archive written: $(du -h "$ARCHIVE" | cut -f1)"
  else
    log "No books or app data found — skipping weekly archive"
  fi
  popd >/dev/null
else
  log "Not a weekly day — skipping full archive"
fi

# --- 3. Upload to Google Drive ------------------------------------------------
# Upload failures are non-fatal: the local copy already exists, so a
# transient network/auth problem must not abort pruning or the run.
if command -v rclone >/dev/null 2>&1; then
  if rclone copy "$DAILY_DIR" "$RCLONE_REMOTE:$RCLONE_PATH/daily" --quiet 2>/dev/null; then
    log "Uploaded daily dump -> $RCLONE_REMOTE:$RCLONE_PATH/daily"
  else
    log "WARNING: daily upload to Google Drive failed (local copy kept)"
  fi
  if rclone copy "$WEEKLY_DIR" "$RCLONE_REMOTE:$RCLONE_PATH/weekly" --quiet 2>/dev/null; then
    log "Uploaded weekly archive -> $RCLONE_REMOTE:$RCLONE_PATH/weekly"
  else
    log "WARNING: weekly upload to Google Drive failed (local copy kept)"
  fi
else
  log "WARNING: rclone not found — backup kept locally only at $BACKUP_DIR"
fi

# --- 4. Prune old backups (local + remote) ------------------------------------
# All pipelines are guarded with `|| true` so empty listings never trip
# `set -euo pipefail`.
prune_local() {
  local dir="$1" keep="$2" prefix="$3" ext="${4:-}"
  [[ -d "$dir" ]] || return 0
  local stale
  stale="$(ls -1 "$dir" 2>/dev/null | grep -E "^$prefix-[0-9]{8}$ext$" | sort -r | tail -n +$((keep + 1)) || true)"
  [[ -z "$stale" ]] && return 0
  while IFS= read -r f; do
    rm -f "$dir/$f"
    log "Pruned local: $dir/$f"
  done <<< "$stale"
}
prune_remote() {
  local sub="$1" keep="$2" prefix="$3" ext="${4:-}"
  command -v rclone >/dev/null 2>&1 || return 0
  local stale
  stale="$(rclone lsf "$RCLONE_REMOTE:$RCLONE_PATH/$sub" 2>/dev/null | grep -E "^$prefix-[0-9]{8}$ext$" | sort -r | tail -n +$((keep + 1)) || true)"
  [[ -z "$stale" ]] && return 0
  while IFS= read -r f; do
    if rclone deletefile "$RCLONE_REMOTE:$RCLONE_PATH/$sub/$f" 2>/dev/null; then
      log "Pruned remote: $RCLONE_PATH/$sub/$f"
    fi
  done <<< "$stale"
}

prune_local "$DAILY_DIR" "$KEEP_DAILY" "bookorbit" ".sql.gz"
prune_local "$WEEKLY_DIR" "$KEEP_WEEKLY" "bookorbit" "-full.tar.gz"
prune_remote "daily" "$KEEP_DAILY" "bookorbit" ".sql.gz"
prune_remote "weekly" "$KEEP_WEEKLY" "bookorbit" "-full.tar.gz"

log "Backup complete."
