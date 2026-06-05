# Music Universe — Deployment Runbook

Production deployment is the user's own Mac, exposed to the public internet
via a named Cloudflare Tunnel. Both services run as launchd LaunchAgents so
they survive reboots.

---

## Status snapshot

| Thing         | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Public URL    | `https://kyote.fawwaz.fun`                                   |
| Local origin  | `http://localhost:3000` (`next start`)                       |
| Tunnel name   | `music-universe`                                             |
| Tunnel UUID   | `29284152-420d-4bb1-93dc-7e0f49bc3344`                       |
| Password      | `Kyowo` (gates the whole app; bcrypt hash in `.env`)         |
| DB            | PostgreSQL on `localhost:5433` (Homebrew service)            |
| Audio source  | `~/Music/MusicUniverse` (`MUSIC_LIBRARY_PATH` in `.env`)     |

---

## Daily operation

### View live logs

```bash
tail -f ~/Library/Logs/MusicUniverse/app.out.log
tail -f ~/Library/Logs/MusicUniverse/app.err.log
tail -f ~/Library/Logs/MusicUniverse/tunnel.out.log
tail -f ~/Library/Logs/MusicUniverse/tunnel.err.log
```

### Restart after a code change

```bash
pnpm build
launchctl kickstart -k gui/$(id -u)/com.musicuniverse.app
```

`-k` forces a restart even if the job is running. The tunnel rarely needs
a restart — it auto-reconnects through network blips — but if you ever
need to:

```bash
launchctl kickstart -k gui/$(id -u)/com.musicuniverse.tunnel
```

### Stop everything (e.g. to use `pnpm dev` for hot-reload work)

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.musicuniverse.app.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.musicuniverse.tunnel.plist
```

Re-enable later with:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.musicuniverse.app.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.musicuniverse.tunnel.plist
```

### Check what's running

```bash
launchctl list | grep musicuniverse
# Two lines with non-negative PIDs = healthy.
# `-` in the PID column = job loaded but not currently running.
```

```bash
curl -sI -o /dev/null -w "HTTP %{http_code} via %{remote_ip}\n" https://kyote.fawwaz.fun/login
# Expected: HTTP 200 via 104.x.x.x
```

---

## Backups

Run on demand:

```bash
./scripts/backup.sh
```

Output lands in `~/Backups/MusicUniverse/<timestamp>/`:

- `db.dump` — pg_dump custom format (restore via `pg_restore`)
- `music.tar.gz` — gzipped tar of the music library (excludes `.cache` and `.DS_Store`)

Backups older than 30 days auto-prune. Tweak with `RETENTION_DAYS=N`.

### Restore the database from a dump

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname="$DATABASE_URL" \
  ~/Backups/MusicUniverse/<timestamp>/db.dump
```

### Restore the music library

```bash
tar -xzf ~/Backups/MusicUniverse/<timestamp>/music.tar.gz -C ~/Music/
# then trigger a rescan from the Settings page, or:
# the chokidar watcher picks up new files automatically
```

---

## Cloudflare Tunnel

### Upgrade cloudflared

```bash
brew upgrade cloudflared
launchctl kickstart -k gui/$(id -u)/com.musicuniverse.tunnel
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
cloudflared tunnel route dns music-universe kyote.fawwaz.fun
# update tunnel + credentials-file in ~/.cloudflared/config.yml with the new UUID
launchctl kickstart -k gui/$(id -u)/com.musicuniverse.tunnel
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
launchctl kickstart -k gui/$(id -u)/com.musicuniverse.app
```

For hot-reload iteration, see "Stop everything" above, then `pnpm dev`.

---

## Troubleshooting

### Tunnel is up but the URL 502s

The app crashed. Check `~/Library/Logs/MusicUniverse/app.err.log`. launchd
will retry after `ThrottleInterval` (10s) — if it's crash-looping, fix the
crash and re-kickstart.

### Port 3000 is already in use after a code change

A leftover `pnpm dev` or a previous launchd app job didn't die cleanly.

```bash
lsof -i :3000 -P -sTCP:LISTEN
# kill the rogue node by PID, then kickstart the app job
```

### `kyote.fawwaz.fun` resolves but never connects

Either the tunnel job isn't running (`launchctl list | grep tunnel`) or
the DNS CNAME got removed from your Cloudflare zone. Re-route:

```bash
cloudflared tunnel route dns music-universe kyote.fawwaz.fun
```

### "Successfully installed" but the app says wrong password

The session cookie cache is per-host. Clear cookies for `kyote.fawwaz.fun`
and try again.

### Whisper transcriptions hang

`whisper-cli` or `ffmpeg` aren't on the launchd `PATH`. The plist sets
`PATH=/opt/homebrew/bin:...` which covers Homebrew installs. If you used
a custom path, edit `deploy/launchd/com.musicuniverse.app.plist`
accordingly and reload the job.

---

## File reference

| Path                                                          | What                                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| `~/Library/LaunchAgents/com.musicuniverse.app.plist`          | App service definition (managed copy)         |
| `~/Library/LaunchAgents/com.musicuniverse.tunnel.plist`       | Tunnel service definition (managed copy)      |
| `~/.cloudflared/config.yml`                                   | Cloudflared ingress rules                     |
| `~/.cloudflared/29284152-...json`                             | Tunnel credentials (keep secret)              |
| `~/.cloudflared/cert.pem`                                     | Origin certificate (CF login token)           |
| `~/Library/Logs/MusicUniverse/`                               | All service stdout/stderr                     |
| `~/Backups/MusicUniverse/`                                    | pg_dump + music tarball backups               |
| `deploy/launchd/`                                             | Source-of-truth plists (in repo)              |
| `deploy/cloudflared/config.example.yml`                       | Source-of-truth tunnel config template        |
| `scripts/backup.sh`                                           | Backup runner                                 |
