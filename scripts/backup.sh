#!/usr/bin/env bash
#
# Kyowave backup
#
#   • PostgreSQL → custom-format pg_dump (compressed, pg_restore-able)
#   • Music library folder → tar.gz of MUSIC_LIBRARY_PATH
#
# Output:
#   ~/Backups/Kyowave/YYYY-MM-DD_HHMMSS/
#     ├── db.dump
#     └── library-mirror/   (shared, not per-timestamp)
#
# Retention: anything older than $RETENTION_DAYS is pruned at the end.
#
# Hardening: fails loudly when the dump file is suspiciously small (e.g. a
# pg_dump version mismatch wrote 0 bytes — we lost 16 days of "successful"
# backups to that silent failure once. Never again).
#
# Usage:
#   pnpm exec dotenv -e .env -- ./scripts/backup.sh
#   …or just `./scripts/backup.sh` if DATABASE_URL + MUSIC_LIBRARY_PATH are
#   already in your shell env.

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Backups/Kyowave}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Any dump file smaller than this is considered broken. Real dumps of even
# a fresh empty schema are typically 5–15 KB compressed.
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-2000}"

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

# ── Version compatibility check ───────────────────────────────────────────────
# A pg_dump older than the server silently writes a 0-byte file and exits
# non-zero. We catch and re-emit that as a fatal error with a clear message
# so it doesn't hide inside cron logs forever.
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
  echo "✗ pg_dump not found ($PG_DUMP_BIN). Install matching PG client tools." >&2
  exit 2
fi
# pg_dump --version prints e.g. "pg_dump (PostgreSQL) 14.20 (Homebrew)" —
# grab the first numeric token.
DUMP_VERSION=$("$PG_DUMP_BIN" --version | grep -Eo '[0-9]+(\.[0-9]+)?' | head -1 | cut -d. -f1)
SERVER_VERSION=$(/opt/homebrew/opt/postgresql@14/bin/psql "$DATABASE_URL" -tAc "SHOW server_version_num;" 2>/dev/null | head -c 2 || echo "")
if [[ -n "$SERVER_VERSION" && -n "$DUMP_VERSION" && "$DUMP_VERSION" -lt "$SERVER_VERSION" ]]; then
  echo "✗ pg_dump version ($DUMP_VERSION) is OLDER than server ($SERVER_VERSION) — would silently fail." >&2
  echo "  Fix: install matching pg_dump or override PG_DUMP_BIN= in env." >&2
  exit 3
fi

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

echo "→ Backup directory: $DEST"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo "→ Dumping database (custom format) with ${PG_DUMP_BIN}…"
"$PG_DUMP_BIN" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DEST/db.dump" \
  "$DATABASE_URL"

# Belt + braces — verify the dump is plausibly real, not 0 bytes from a
# silent pg_dump failure that exited 0 anyway.
DB_BYTES=$(stat -f "%z" "$DEST/db.dump" 2>/dev/null || stat -c "%s" "$DEST/db.dump")
if [[ "$DB_BYTES" -lt "$MIN_DUMP_BYTES" ]]; then
  echo "✗ db.dump is only $DB_BYTES bytes (threshold $MIN_DUMP_BYTES). Treating as failure." >&2
  rm -f "$DEST/db.dump"
  rmdir "$DEST" 2>/dev/null || true
  exit 4
fi
DB_SIZE=$(du -h "$DEST/db.dump" | awk '{print $1}')
echo "  ✓ db.dump ($DB_SIZE, $DB_BYTES bytes)"

# Optional: smoke-test the dump can be parsed by pg_restore. Catches any
# corruption before the file ages into retention.
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
if command -v "$PG_RESTORE_BIN" >/dev/null 2>&1; then
  if ! "$PG_RESTORE_BIN" -l "$DEST/db.dump" >/dev/null 2>&1; then
    echo "✗ db.dump fails pg_restore -l (corrupt file)" >&2
    rm -f "$DEST/db.dump"
    exit 5
  fi
  echo "  ✓ pg_restore -l verified"
fi

# ── Music library ─────────────────────────────────────────────────────────────
#
# This used to `tar --exclude='.cache'`, which excluded the entire library:
# every downloaded track lives in .cache/yt, so music.tar.gz was 360 bytes
# containing one empty directory while 3 GB of audio went unprotected.
#
# It is a mirror rather than a snapshot on purpose. The files are immutable and
# content-addressed (<videoId>.m4a), so N dated copies would be N copies of the
# same bytes — 3 GB/day against 30-day retention is 90 GB, on a disk with 63 GB
# free. They are also already-compressed m4a, so gzipping them daily costs CPU
# and saves nothing. One incremental mirror gives the same protection for the
# size of the library.
#
# No --delete: a track removed from the library (or lost to a bad disk) stays
# in the mirror. This is a backup, not a sync.
MIRROR="$BACKUP_ROOT/library-mirror"
echo "→ Mirroring music library at ${MUSIC_LIBRARY_PATH}…"
mkdir -p "$MIRROR"
rsync -a --exclude='.DS_Store' \
  "$MUSIC_LIBRARY_PATH/" "$MIRROR/" \
  || { echo "✗ library mirror failed" >&2; exit 6; }
MIRROR_SIZE=$(du -sh "$MIRROR" | awk '{print $1}')
MIRROR_FILES=$(find "$MIRROR" -type f | wc -l | tr -d ' ')
echo "  ✓ library mirror ($MIRROR_SIZE, $MIRROR_FILES files)"

if [[ "$MIRROR_FILES" -lt 1 ]]; then
  echo "✗ library mirror is empty — refusing to report success" >&2
  exit 7
fi

# ── Retention ────────────────────────────────────────────────────────────────
echo "→ Pruning backups older than $RETENTION_DAYS days…"
PRUNED=0
while IFS= read -r -d '' old; do
  rm -rf "$old"
  echo "  ✗ removed $(basename "$old")"
  PRUNED=$((PRUNED + 1))
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '2*' -mtime "+$RETENTION_DAYS" -print0)
echo "  ✓ pruned $PRUNED old backup(s)"

# ── Off-host copy (optional but recommended) ──────────────────────────────────
# Configure OFFSITE_DIR to e.g. ~/Library/Mobile Documents/com~apple~CloudDocs/Kyowave-Backups
# (iCloud Drive) or an external/NAS path to mirror today's snapshot off-host.
# Without this, your only copy is on the same disk as the source — a dead
# SSD takes both at once.
if [[ -n "${OFFSITE_DIR:-}" ]]; then
  mkdir -p "$OFFSITE_DIR"
  # Plain cp, not `cp -p`. iCloud Drive rejects the attribute-preserving copy
  # with "Operation not permitted", which failed silently on every run — 52
  # consecutive failures before anyone looked at the log.
  #
  # And remove before writing, for a related but separate reason.
  #
  # macOS lets this job modify files IT created in iCloud Drive, and refuses on
  # files created by another process (they carry that process's
  # com.apple.provenance). The first scheduled run copied db.dump.<stamp> fine
  # — a fresh create — and failed on db.dump.latest, which an interactive shell
  # had created days earlier. So "latest" sat a day stale. Testing by hand
  # never reproduces it, because by hand you ARE the other process.
  #
  # REPAIR, if the err log ever shows this again: delete the offending file
  # from Finder or a shell, then run the job once. It recreates the file, owns
  # it, and can overwrite it from then on. Verified by doing exactly that.
  offsite_put() {
    local src=$1 dest=$2 label=$3
    rm -f "$dest" 2>/dev/null || true
    cp "$src" "$dest" \
      || { echo "  ! offsite copy failed ($label)" >&2; OFFSITE_OK=0; return 1; }
  }
  offsite_put "$DEST/db.dump" "$OFFSITE_DIR/db.dump.latest" "db.dump.latest" || true
  offsite_put "$DEST/db.dump" "$OFFSITE_DIR/db.dump.$STAMP" "db.dump.$STAMP" || true

  # Assert rather than assume: a "latest" that is older than this run's dump is
  # the exact silent failure this whole block exists to prevent.
  if [[ "${OFFSITE_OK:-1}" == "1" ]] \
     && ! cmp -s "$DEST/db.dump" "$OFFSITE_DIR/db.dump.latest"; then
    echo "  ! offsite db.dump.latest does not match this run's dump" >&2
    OFFSITE_OK=0
  fi
  # The audio mirror is deliberately not pushed to iCloud: 3 GB of immutable
  # m4a would churn the sync client daily for no benefit. Point OFFSITE_DIR at
  # an external drive if you want the audio off-host too.
  if [[ "${OFFSITE_OK:-1}" == "1" ]]; then
    echo "  ✓ mirrored to $OFFSITE_DIR"
  else
    echo "  ! offsite mirror INCOMPLETE — check permissions on $OFFSITE_DIR" >&2
  fi
fi

TOTAL=$(du -sh "$DEST" | awk '{print $1}')
echo
echo "✓ Backup complete — $TOTAL at $DEST"
