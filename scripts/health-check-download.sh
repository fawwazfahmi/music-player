#!/usr/bin/env bash
#
# launchd entrypoint for the weekly download-health probe. Kept as a thin
# wrapper (like backup.sh) so the plist doesn't hard-code the pnpm/tsx
# invocation and env loading.
#
#   ./scripts/health-check-download.sh
#
# Runs one real yt-dlp download; exits non-zero + fires a macOS notification
# if it fails (the yt-dlp player-client gating regression). See
# scripts/health-check-download.ts for the logic.
set -euo pipefail

cd "$(dirname "$0")/.."
exec pnpm exec tsx --env-file=.env scripts/health-check-download.ts
