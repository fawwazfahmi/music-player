# Kyowave — Deployment Runbook

Production deployment is the user's own Mac, exposed to the public internet
via a named Cloudflare Tunnel. Both services run as launchd LaunchAgents so
they survive reboots.

---

## Status snapshot

| Thing         | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Public URL    | `https://kyowave.wazfahmi.site`                                |
| Local origin  | `http://127.0.0.1:3100` (`next start`, PORT set in the plist)|
| Tunnel name   | `music-universe`                                             |
| Tunnel UUID   | `29284152-420d-4bb1-93dc-7e0f49bc3344`                       |
| Password      | `Kyowo` (gates the whole app; bcrypt hash in `.env`)         |
| DB            | PostgreSQL on `localhost:5433` (Homebrew service)            |
| Audio source  | `~/Music/Kyowave` (`MUSIC_LIBRARY_PATH` in `.env`)     |

---

## Daily operation

### View live logs

```bash
tail -f ~/Library/Logs/Kyowave/app.out.log
tail -f ~/Library/Logs/Kyowave/app.err.log
tail -f ~/Library/Logs/Kyowave/tunnel.out.log
tail -f ~/Library/Logs/Kyowave/tunnel.err.log
```

### Deploy a code change

```bash
./scripts/deploy.sh
```

Preflight → migrate → build → restart → verify, exiting non-zero on any
failure. It refuses to leave the box in a mismatched state, reclaims the port
from an orphaned process, and finishes by fetching the stylesheet the live
login page references — the check that catches a stale server while
`/api/health` still reports OK.

Flags: `--skip-migrate`, `--skip-verify`. Overridable env: `PORT`, `LABEL`,
`PUBLIC_URL`, `HEALTH_TIMEOUT_SEC`.

The manual equivalent, if you ever need to run the steps by hand:

```bash
pnpm build
launchctl kickstart -k gui/$(id -u)/com.kyowave.app
```

**Never run `pnpm build` on its own here.** It does not merely leave the site
stale — it breaks it immediately. `next start` holds one BUILD_ID in memory,
and a rebuild replaces every content-hashed chunk in `.next/static`. The
running server keeps serving HTML that points at the *old* filenames, which
no longer exist, so:

- every CSS chunk 500s and the site renders as unstyled HTML;
- server actions fail the build-ID check, so pages look empty (e.g. "Library
  is empty" with a full database).

Seen 12 Aug 2026 after a `git switch` + `pnpm build` with no kickstart. The
fix is just the kickstart — nothing is corrupted. To confirm you have hit
this rather than something real:

```bash
cat .next/BUILD_ID                      # what is on disk
ps -o lstart -p $(lsof -tnP -iTCP:3100 -sTCP:LISTEN | head -1)   # when the server booted
# server older than BUILD_ID's mtime => stale process, kickstart it
```

`-k` forces a restart even if the job is running. The tunnel rarely needs
a restart — it auto-reconnects through network blips — but if you ever
need to:

```bash
launchctl kickstart -k gui/$(id -u)/com.kyowave.tunnel
```

### Stop everything (e.g. to use `pnpm dev` for hot-reload work)

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.kyowave.app.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.kyowave.tunnel.plist
```

Re-enable later with:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kyowave.app.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kyowave.tunnel.plist
```

### Check what's running

```bash
launchctl list | grep kyowave
# Two lines with non-negative PIDs = healthy.
# `-` in the PID column = job loaded but not currently running.
```

```bash
curl -sI -o /dev/null -w "HTTP %{http_code} via %{remote_ip}\n" https://kyowave.wazfahmi.site/login
# Expected: HTTP 200 via 104.x.x.x
```

---

## Backups

Run on demand:

```bash
./scripts/backup.sh
```

Output lands in `~/Backups/Kyowave/<timestamp>/`:

- `db.dump` — pg_dump custom format (restore via `pg_restore`)
- `library-mirror/` — incremental rsync mirror of the music library, one copy
  shared by every snapshot (the audio is immutable, so dated copies would be
  the same 3 GB over and over)

Dated snapshots older than 30 days auto-prune. Tweak with `RETENTION_DAYS=N`.
The library mirror is never pruned.

### Restore the database from a dump

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname="$DATABASE_URL" \
  ~/Backups/Kyowave/<timestamp>/db.dump
```

### Restore the music library

```bash
rsync -a ~/Backups/Kyowave/library-mirror/ ~/Music/MusicUniverse/
# then trigger a rescan from the Settings page, or:
# the chokidar watcher picks up new files automatically
```

The mirror is not per-timestamp — it is a single always-current copy at
`~/Backups/Kyowave/library-mirror/`, outside the dated snapshot directories so
retention cannot prune it.

---

## Cloudflare Tunnel

### Upgrade cloudflared

```bash
brew upgrade cloudflared
launchctl kickstart -k gui/$(id -u)/com.kyowave.tunnel
```

### Inspect tunnel state

```bash
cloudflared tunnel info music-universe
cloudflared tunnel list
```

### Local metrics (Prometheus)

The tunnel job exposes metrics at `http://localhost:55556/metrics` for ad-hoc
inspection. Not exposed externally.

### Rotate the tunnel credentials

If `~/.cloudflared/<UUID>.json` is ever compromised:

```bash
cloudflared tunnel delete music-universe
cloudflared tunnel create music-universe   # writes a new UUID + JSON
cloudflared tunnel route dns music-universe kyowave.wazfahmi.site
# update tunnel + credentials-file in ~/.cloudflared/config.yml with the new UUID
launchctl kickstart -k gui/$(id -u)/com.kyowave.tunnel
```

---

## Code-change flow

```bash
# 1. write code, commit
# 2. if deps changed:
pnpm install
# 3. if there are new migrations:
pnpm exec prisma migrate deploy
# 4. always:
pnpm build
launchctl kickstart -k gui/$(id -u)/com.kyowave.app
```

For hot-reload iteration, see "Stop everything" above, then `pnpm dev`.

---

## Troubleshooting

### Tunnel is up but the URL 502s

The app crashed. Check `~/Library/Logs/Kyowave/app.err.log`. launchd
will retry after `ThrottleInterval` (10s) — if it's crash-looping, fix the
crash and re-kickstart.

### Port 3100 is already in use / the app job silently never runs

The failure mode to watch for: `launchctl list | grep kyowave` shows
`-` in the PID column for `com.kyowave.app` with exit status `1`, yet
the site still loads. That means an **orphaned `pnpm start`** (PPID 1, from a
manual run) is holding 3100, and the managed job has been crash-looping on
`EADDRINUSE` behind it — possibly for days. The site serves whatever build
that orphan started with, so deploys appear to do nothing.

Seen in the wild 12 Aug 2026: an orphan from 8 Aug had been serving prod for
3 days while every `kickstart` failed.

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN     # find the listener
ps -o pid,ppid,lstart,command -p <PID>   # PPID 1 => orphan, not launchd
kill <listener-pid> <its-parent-pid>
# KeepAlive restarts the managed job within ~10s; confirm it took the port:
launchctl list | grep kyowave   # app should now show a real PID
```

### `kyowave.wazfahmi.site` resolves but never connects

Either the tunnel job isn't running (`launchctl list | grep tunnel`) or
the DNS CNAME got removed from your Cloudflare zone. Re-route:

```bash
cloudflared tunnel route dns music-universe kyowave.wazfahmi.site
```

### "Successfully installed" but the app says wrong password

The session cookie cache is per-host. Clear cookies for `kyowave.wazfahmi.site`
and try again.

### Whisper transcriptions hang

`whisper-cli` or `ffmpeg` aren't on the launchd `PATH`. The plist sets
`PATH=/opt/homebrew/bin:...` which covers Homebrew installs. If you used
a custom path, edit `deploy/launchd/com.kyowave.app.plist`
accordingly and reload the job.

---

## File reference

| Path                                                          | What                                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| `~/Library/LaunchAgents/com.kyowave.app.plist`          | App service definition (managed copy)         |
| `~/Library/LaunchAgents/com.kyowave.tunnel.plist`       | Tunnel service definition (managed copy)      |
| `~/.cloudflared/config.yml`                                   | Cloudflared ingress rules                     |
| `~/.cloudflared/29284152-...json`                             | Tunnel credentials (keep secret)              |
| `~/.cloudflared/cert.pem`                                     | Origin certificate (CF login token)           |
| `~/Library/Logs/Kyowave/`                               | All service stdout/stderr                     |
| `~/Backups/Kyowave/`                                    | pg_dump + music tarball backups               |
| `deploy/launchd/`                                             | Source-of-truth plists (in repo)              |
| `deploy/cloudflared/config.example.yml`                       | Source-of-truth tunnel config template        |
| `scripts/backup.sh`                                           | Backup runner                                 |
