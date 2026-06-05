#!/usr/bin/env bash
#
# Music Universe backup
#
#   • PostgreSQL → custom-format pg_dump (compressed, pg_restore-able)
#   • Music library folder → tar.gz of MUSIC_LIBRARY_PATH
#
# Output:
#   ~/Backups/MusicUniverse/YYYY-MM-DD_HHMMSS/
#     ├── db.dump
#     └── music.tar.gz
#
# Retention: anything older than $RETENTION_DAYS is pruned at the end.
#
# Usage:
#   pnpm exec dotenv -e .env -- ./scripts/backup.sh
#   …or just `./scripts/backup.sh` if DATABASE_URL + MUSIC_LIBRARY_PATH are
#   already in your shell env.

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Backups/MusicUniverse}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    set -a; source .env; set +a
  fi
fi

: "${DATABASE_URL:?DATABASE_URL is required (export it or run from project root with .env)}"
: "${MUSIC_LIBRARY_PATH:?MUSIC_LIBRARY_PATH is required}"

if [[ ! -d "$MUSIC_LIBRARY_PATH" ]]; then
  echo "✗ MUSIC_LIBRARY_PATH does not exist: $MUSIC_LIBRARY_PATH" >&2
  exit 1
fi

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

echo "→ Backup directory: $DEST"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo "→ Dumping database (custom format)…"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
"$PG_DUMP_BIN" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DEST/db.dump" \
  "$DATABASE_URL"
DB_SIZE=$(du -h "$DEST/db.dump" | awk '{print $1}')
echo "  ✓ db.dump ($DB_SIZE)"

# ── Music library ─────────────────────────────────────────────────────────────
echo "→ Archiving music library at $MUSIC_LIBRARY_PATH…"
tar \
  --exclude='.DS_Store' \
  --exclude='.cache' \
  -czf "$DEST/music.tar.gz" \
  -C "$(dirname "$MUSIC_LIBRARY_PATH")" \
  "$(basename "$MUSIC_LIBRARY_PATH")"
MUSIC_SIZE=$(du -h "$DEST/music.tar.gz" | awk '{print $1}')
echo "  ✓ music.tar.gz ($MUSIC_SIZE)"

# ── Retention ────────────────────────────────────────────────────────────────
echo "→ Pruning backups older than $RETENTION_DAYS days…"
# -mindepth 1 so we never delete BACKUP_ROOT itself; -maxdepth 1 because each
# backup is a single timestamp directory directly under the root.
PRUNED=0
while IFS= read -r -d '' old; do
  rm -rf "$old"
  echo "  ✗ removed $(basename "$old")"
  PRUNED=$((PRUNED + 1))
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print0)
echo "  ✓ pruned $PRUNED old backup(s)"

TOTAL=$(du -sh "$DEST" | awk '{print $1}')
echo
echo "✓ Backup complete — $TOTAL at $DEST"
