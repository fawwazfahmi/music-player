#!/usr/bin/env bash
#
# Deploy music-player to the local production box (this Mac, behind the
# Cloudflare tunnel). Run from the repo root:
#
#   ./scripts/deploy.sh
#
# Why this exists — two real outages, both from build and restart being
# separate manual steps:
#
#   1. An orphaned `pnpm start` (PPID 1, from a manual run) held port 3100
#      while the launchd job crash-looped on EADDRINUSE behind it. The site
#      looked healthy but served a three-day-old build, and every deploy
#      silently changed nothing.
#
#   2. `pnpm build` without the restart doesn't leave the site stale, it
#      breaks it: `next start` pins one BUILD_ID, the rebuild rewrites every
#      content-hashed chunk, and the running server keeps serving HTML that
#      points at filenames which no longer exist. CSS 500s (page renders as
#      raw unstyled HTML) and server actions fail the build-ID check (pages
#      read as empty against a full database).
#
# So: this script never builds without restarting, refuses to hand the port
# to anything but launchd, and verifies a real asset loads before declaring
# success. Any failure exits non-zero with the remediation.
#
# Flags:
#   --skip-migrate   don't run prisma migrate deploy
#   --skip-verify    don't poll the public URL (use on a box with no tunnel)

set -euo pipefail

PORT="${PORT:-3100}"
LABEL="${LABEL:-com.musicuniverse.app}"
PUBLIC_URL="${PUBLIC_URL:-https://kyote.wazfahmi.site}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-60}"

SKIP_MIGRATE=0
SKIP_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --skip-verify)  SKIP_VERIFY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

trap 'die "deploy aborted on line $LINENO — the app may be mid-restart; check: launchctl list | grep $LABEL"' ERR

# ── 0. Preflight ──────────────────────────────────────────────────────────
bold "→ Preflight"

[[ -f package.json && -d prisma ]] || die "run this from the repo root"
command -v pnpm >/dev/null || die "pnpm not found on PATH"
command -v lsof >/dev/null || die "lsof not found on PATH"

GIT_REF="$(git rev-parse --short HEAD) ($(git branch --show-current))"
ok "deploying $GIT_REF"

if [[ -n "$(git status --porcelain)" ]]; then
  warn "working tree is dirty — the build includes uncommitted changes:"
  git status --short | sed 's/^/      /'
fi

# ── 1. Make sure launchd, not an orphan, owns the port ────────────────────
bold "→ Checking who owns port $PORT"

job_pid() { launchctl list | awk -v l="$LABEL" '$3==l {print $1}'; }

JOB_PID="$(job_pid || true)"
LISTENER="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"

if [[ -n "$LISTENER" ]]; then
  LISTENER_PPID="$(ps -o ppid= -p "$LISTENER" 2>/dev/null | tr -d ' ' || echo "")"
  if [[ "$JOB_PID" == "-" || -z "$JOB_PID" ]]; then
    # Nothing managed is running, yet the port is taken. That is the orphan.
    warn "port $PORT held by pid $LISTENER but $LABEL is not running — orphaned process"
    ps -o pid,ppid,lstart,command -p "$LISTENER" 2>/dev/null | tail -1 | cut -c1-120 | sed 's/^/      /'
    echo "      killing it so launchd can take the port"
    kill "$LISTENER" 2>/dev/null || true
    # Also kill the wrapper that spawned it, or its KeepAlive-less shell will
    # just sit there — but only when it really is the `pnpm start` wrapper.
    # Killing an arbitrary parent because it happens to own the listener is
    # how a cleanup step turns into a second outage.
    if [[ -n "$LISTENER_PPID" && "$LISTENER_PPID" != "1" ]]; then
      PARENT_CMD="$(ps -o command= -p "$LISTENER_PPID" 2>/dev/null || echo "")"
      if [[ "$PARENT_CMD" == *"pnpm"* && "$PARENT_CMD" == *"start"* ]]; then
        echo "      also killing its wrapper $LISTENER_PPID ($PARENT_CMD)"
        kill "$LISTENER_PPID" 2>/dev/null || true
      else
        warn "leaving parent $LISTENER_PPID alone — not a pnpm start wrapper"
      fi
    fi
    for _ in $(seq 1 10); do
      sleep 1
      lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    done
    if lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      die "port $PORT is still held. Kill it by hand: lsof -nP -iTCP:$PORT -sTCP:LISTEN"
    fi
    ok "port freed"
  else
    ok "port owned by $LABEL (job pid $JOB_PID)"
  fi
else
  ok "port $PORT is free"
fi

# ── 2. Migrations ─────────────────────────────────────────────────────────
if [[ "$SKIP_MIGRATE" -eq 1 ]]; then
  bold "→ Migrations (skipped)"
else
  bold "→ Migrations"
  # `migrate deploy` only applies pending migrations and never resets. Do NOT
  # swap this for `migrate dev`, which can offer to drop the database — this
  # is production.
  MIGRATE_LOG="$(mktemp)"
  if ! pnpm exec prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
    cat "$MIGRATE_LOG" >&2
    die "prisma migrate deploy failed (log: $MIGRATE_LOG)"
  fi
  if ! pnpm exec prisma generate >>"$MIGRATE_LOG" 2>&1; then
    cat "$MIGRATE_LOG" >&2
    die "prisma generate failed (log: $MIGRATE_LOG)"
  fi
  APPLIED="$(grep -c "applied" "$MIGRATE_LOG" || true)"
  rm -f "$MIGRATE_LOG"
  if [[ "$APPLIED" -gt 0 ]]; then
    ok "migrations applied"
  else
    ok "schema up to date"
  fi
fi

# ── 3. Build ──────────────────────────────────────────────────────────────
bold "→ Building"
BUILD_LOG="$(mktemp)"
if ! pnpm build >"$BUILD_LOG" 2>&1; then
  tail -30 "$BUILD_LOG" >&2
  die "build failed (full log: $BUILD_LOG)"
fi
grep -q "Compiled successfully" "$BUILD_LOG" || {
  tail -30 "$BUILD_LOG" >&2
  die "build did not report success (full log: $BUILD_LOG)"
}
NEW_BUILD_ID="$(cat .next/BUILD_ID)"
rm -f "$BUILD_LOG"
ok "built $NEW_BUILD_ID"

# From here the on-disk build no longer matches the running server. The
# restart below is not optional — skipping it is outage #2 above.

# ── 4. Restart ────────────────────────────────────────────────────────────
bold "→ Restarting $LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL" || die "kickstart failed — is the LaunchAgent loaded? launchctl list | grep $LABEL"
ok "kickstart sent"

# ── 5. Verify ─────────────────────────────────────────────────────────────
bold "→ Verifying"

deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
until curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; do
  [[ $(date +%s) -lt $deadline ]] || die "local health never came up within ${HEALTH_TIMEOUT_SEC}s. Check: tail -50 ~/Library/Logs/MusicUniverse/app.err.log"
  sleep 2
done
ok "local health ok"

NEW_LISTENER="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
NEW_JOB_PID="$(job_pid || true)"
if [[ -n "$NEW_LISTENER" && -n "$NEW_JOB_PID" && "$NEW_JOB_PID" != "-" ]]; then
  LP="$(ps -o ppid= -p "$NEW_LISTENER" 2>/dev/null | tr -d ' ' || echo "")"
  if [[ "$LP" == "$NEW_JOB_PID" ]]; then
    ok "port owned by launchd job $NEW_JOB_PID (no orphan)"
  else
    warn "listener $NEW_LISTENER is not a child of job $NEW_JOB_PID — check for a stray process"
  fi
fi

if [[ "$SKIP_VERIFY" -eq 1 ]]; then
  bold "→ Public check (skipped)"
else
  bold "→ Public check"
  until curl -fsS --max-time 8 "$PUBLIC_URL/api/health" 2>/dev/null | grep -q '"ok":true'; do
    [[ $(date +%s) -lt $deadline ]] || die "$PUBLIC_URL/api/health not ok within ${HEALTH_TIMEOUT_SEC}s — is the tunnel up? launchctl list | grep tunnel"
    sleep 2
  done
  ok "$PUBLIC_URL health ok"

  # The direct regression test for outage #2: pull the login page, take the
  # stylesheet it actually references, and confirm that file is really
  # served. A stale process fails here with a 500 while /api/health is
  # perfectly happy.
  HTML="$(curl -fsS --max-time 10 "$PUBLIC_URL/login" || true)"
  CSS="$(printf '%s' "$HTML" | grep -oE '/_next/static/[^"\\]+\.css' | head -1 || true)"
  if [[ -z "$CSS" ]]; then
    warn "no stylesheet found on /login — skipping asset check"
  else
    CODE="$(curl -sI -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL$CSS")"
    [[ "$CODE" == "200" ]] || die "stylesheet $CSS returned HTTP $CODE — the served build does not match .next (BUILD_ID $NEW_BUILD_ID). Re-run: launchctl kickstart -k gui/$(id -u)/$LABEL"
    ok "stylesheet serves 200 ($CSS)"
  fi
fi

trap - ERR
printf "\n\033[32m✓ Deployed %s → %s\033[0m\n" "$GIT_REF" "$PUBLIC_URL"
