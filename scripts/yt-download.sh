#!/usr/bin/env bash
#
# Manually batch-download a YouTube URL (single video, real playlist, or
# auto-generated mix) straight into the music library. Files land in
# MUSIC_LIBRARY_PATH/YouTube/<playlist-or-title>/ and the running app's
# chokidar watcher auto-ingests them — no web round-trip, no Cloudflare
# tunnel, no API timeouts.
#
# Parallel downloads (4 by default) and -x audio extraction match the
# settings the web /api/yt-download path uses, so the files are byte-for-
# byte compatible.
#
# Usage:
#   ./scripts/yt-download.sh <URL>
#   ./scripts/yt-download.sh <URL> 50          # take 50 entries
#   ./scripts/yt-download.sh <URL> all         # no playlist cap
#
# Examples:
#   ./scripts/yt-download.sh 'https://www.youtube.com/watch?v=…&list=RD…'
#   ./scripts/yt-download.sh 'https://www.youtube.com/playlist?list=PL…' 100
#
# Env overrides:
#   MUSIC_LIBRARY_PATH (else read from .env)
#   YT_DLP_BIN  (default: /opt/homebrew/bin/yt-dlp)
#   PARALLEL    (default: 4 — concurrent fragments per video)

set -euo pipefail

URL="${1:-}"
COUNT="${2:-50}"

if [[ -z "$URL" ]]; then
  echo "Usage: $0 <youtube-url> [count|all]" >&2
  exit 1
fi

# Pull MUSIC_LIBRARY_PATH from .env if not already in env.
if [[ -z "${MUSIC_LIBRARY_PATH:-}" && -f .env ]]; then
  set -a; source .env; set +a
fi
: "${MUSIC_LIBRARY_PATH:?MUSIC_LIBRARY_PATH not set and no .env}"

YT_DLP_BIN="${YT_DLP_BIN:-/opt/homebrew/bin/yt-dlp}"
PARALLEL="${PARALLEL:-4}"
DEST="$MUSIC_LIBRARY_PATH/YouTube"
mkdir -p "$DEST"

PLAYLIST_FLAGS=()
if [[ "$COUNT" != "all" ]]; then
  PLAYLIST_FLAGS+=(--playlist-end "$COUNT")
fi

echo "→ Destination: $DEST"
echo "→ yt-dlp:      $YT_DLP_BIN"
echo "→ Cap:         $([[ "$COUNT" == "all" ]] && echo "no cap" || echo "first $COUNT")"
echo "→ Parallel:    $PARALLEL fragments per video"
echo

"$YT_DLP_BIN" \
  "$URL" \
  -x \
  --audio-format m4a \
  --embed-metadata \
  --embed-thumbnail \
  -N "$PARALLEL" \
  --no-warnings \
  --newline \
  --ignore-errors \
  -o "$DEST/%(playlist_title|YouTube)s/%(playlist_index)03d - %(title)s.%(ext)s" \
  "${PLAYLIST_FLAGS[@]}"

echo
echo "✓ Done. The library scanner picks new files up automatically — they'll"
echo "  appear in the app within a few seconds. Run 'pnpm exec prisma studio'"
echo "  if you want to verify the rows landed."
