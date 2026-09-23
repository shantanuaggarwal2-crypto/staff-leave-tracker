#!/bin/bash
# Pulls data/db.json from the live Railway deployment and saves a timestamped
# local copy. Run daily via the LaunchAgent installed alongside this script.
set -euo pipefail

PROJECT_DIR="/Users/shantanuaggarwal/staff-leave-tracker"
BACKUP_DIR="/Users/shantanuaggarwal/staff-leave-tracker-backups"
RETENTION_DAYS=90

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/db-$STAMP.json"
TMP="$OUT.tmp"

cd "$PROJECT_DIR"
/Users/shantanuaggarwal/.npm-global/bin/railway ssh -- cat data/db.json > "$TMP" 2>>"$BACKUP_DIR/backup.log"

# Sanity check: only keep it if it's valid, non-trivial JSON
if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$TMP" \
   && [ "$(stat -f%z "$TMP")" -gt 20 ]; then
  mv "$TMP" "$OUT"
  echo "$(date): backed up to $OUT" >> "$BACKUP_DIR/backup.log"
else
  echo "$(date): backup FAILED validation, discarding" >> "$BACKUP_DIR/backup.log"
  rm -f "$TMP"
  exit 1
fi

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name 'db-*.json' -mtime +"$RETENTION_DAYS" -delete
