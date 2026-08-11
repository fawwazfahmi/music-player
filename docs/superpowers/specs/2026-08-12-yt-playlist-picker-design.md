# YouTube Playlist/Mix Picker + Downloads Tab — Design

**Date:** 2026-08-12
**Status:** Approved, pending implementation plan

## Problem

Pasting a YouTube Mix link adds mostly-irrelevant songs to the queue. Two
independent root causes, both confirmed by running the app's exact yt-dlp
invocation against a live Mix URL.

### Root cause 1 — a Mix is an infinite generator, and we fetch all of it

`fetchPlaylist` asks yt-dlp for the entire list. A Mix (`RD…`) has no end, so
yt-dlp walks continuation pages until it gives up. Three identical calls to the
same URL:

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| entries returned | 366 | 1769 | 366 |
| unique video IDs | 366 | 372 | 366 |
| duplicates within first 30 | 0 | 4 | 0 |

Run 2 looped the same ~370 videos roughly five times. Only **15 of the first 30
entries appear in all three runs**; any two runs overlap on 18–20 of 30.

The head of the stream (~first 15–20) is genuinely seeded on the source video.
Past that it drifts into generic recommendations — one run returned Iyaz, Sean
Paul, Maroon 5, The Chainsmokers and Charlie Puth at positions 20–26, from a
1985 Rick Astley seed.

`PLAYLIST_MAX_TRACKS = 30` slices straight across that boundary, so the back
third of every paste is drift. This matches the reported symptom exactly: some
of it hits, most of it doesn't.

### Root cause 2 — personalization never leaves the browser

The `RD` list ID encodes only the seed video (`RDdQw4w9WgXcQ` is literally `RD`
+ the video ID). The personalized ordering lives in the user's logged-in
YouTube session. The server calls yt-dlp with no cookies, so YouTube serves an
anonymous cold-start radio. Account-scoped `RDMM…` ("My Mix") links degrade
hardest.

### Contrast: real playlists are fine

A `PL…` playlist fetched twice returned **13 entries, identical order, zero
duplicates, both runs**. Deterministic and finite. The current code treats
mixes and playlists identically, which is wrong in both directions — it lets
mixes flood the queue with drift, and it would silently truncate an album at 30.

### Secondary bug

The success toast says *"mix has N — paste again for more"*, but
`enqueuePlaylist` always slices `0..30` with no offset. Pasting again re-rolls
another random head slice rather than advancing. The `available` count it
reports is the looped total, not distinct songs.

## Goals

1. User sees the fetched songs and prunes them **before** anything downloads.
2. Downloading never touches the play queue or interrupts playback.
3. Download progress is visible, survives reload, and shows real numbers.
4. Optional per-user YouTube cookies restore genuine personalization.

## Non-goals

- Resuming a mix where a previous paste left off (no offset/pagination).
- A full historical download log. Retention is 24h.
- Hardening `mu_name` into a real identity. See "Security posture".

## Architecture

### 1. List classification and preview fetch

```
classifyListUrl(url) -> { kind: "mix" | "playlist", listId }
```

`RD`, `RDMM`, `RDAMVM`, `RDEM` prefixes are mixes. Everything else (`PL`,
`OLAK5uy_`, `UU`) is a playlist.

`fetchPlaylist(url, opts)` behaviour by kind:

| | mix | playlist |
|---|---|---|
| `--playlist-end` | 40 | not passed |
| dedupe by videoId | yes, keep first occurrence | no |
| order | as returned | as returned |

`--playlist-end 40` is what stops the continuation runaway. It bounds the call
to one or two pages instead of the unbounded walk that produced 1769 entries.

```
previewPlaylist(url) -> { kind, listId, title, tracks[], defaultCheckedCount }
```

**Read-only. No Track rows, no YtCacheEntry, no downloads.** `defaultCheckedCount`
is 20 for mixes, `tracks.length` for playlists.

The 20 is a heuristic derived from a handful of runs on one seed, not a measured
constant. It will be roughly right and occasionally wrong. It only sets a
default checkbox state, so being wrong costs the user two clicks.

### 2. API routes

| route | purpose | side effects |
|---|---|---|
| `POST /api/yt-playlist/preview` | fetch + classify | none |
| `POST /api/yt-playlist/enqueue` | create rows, start download chain | DB writes, spawns yt-dlp |
| `GET /api/downloads` | active + last 24h | none |
| `POST /api/downloads/[videoId]/retry` | re-run a failed download | DB write, spawns yt-dlp |

`POST /api/yt-playlist` is removed, along with the "paste again for more" toast.

`enqueue` accepts entry metadata (videoId, title, uploader, duration,
thumbnail) echoed back from the preview response rather than re-fetching it
server-side. This trusts the client with data that originated from our own
preview call. Acceptable for a two-person password-gated app; noted rather than
mitigated.

Downloads remain **sequential** via the existing `runPlaylistDownloadChain`, so
a 40-song selection doesn't fork 40 yt-dlp processes.

### 3. Picker screen

New nav route `{ name: "ytPlaylistPicker"; url: string }` on the existing iPod
nav stack.

`SearchPage`'s detection card collapses from two buttons ("Play playlist",
"Add to queue") to one: **"Review N songs"**, which pushes the picker.

Picker contents:

- Header: kind badge (Mix / Playlist), list title, selected count.
- Select all / select none.
- Rows: checkbox, thumbnail, title, uploader, duration.
- Mixes only: a divider after item 20 — "below here the mix drifts from the
  seed — unchecked by default".
- Sticky footer: **"Download N songs"** → calls enqueue → pushes Downloads.

### 4. Downloads screen

New nav route `{ name: "downloads" }`. Sidebar entry with a badge count while
anything is active.

**Server-backed.** Polls `GET /api/downloads` every 1s while any job is in
flight; stops polling when idle. Survives reload and navigation, and reflects
downloads started from any device.

Sections:

- **Active** — real progress from `downloadedBytes` / `totalBytes`. No fake
  progress animation.
- **Failed** — error message, retry button.
- **Completed (last 24h)** — per-row **Add to queue**, plus **Add all to queue**.

Because every download path already writes `YtCacheEntry`, single-track YT
picker downloads appear here automatically. **`download-store.ts` is not
modified** — the existing floating toast keeps working unchanged, and the tab is
a separate server-truth view rather than a competing client-side cache.

### 5. Per-user YouTube cookies

Settings gains a "Connect YouTube" section, scoped per identity (`ainul`,
`fawwaz`).

Flow: user exports `cookies.txt` from their browser (via a cookie-exporter
extension — `document.cookie` cannot reach these; the session cookies are
`HttpOnly` and cross-origin) and uploads it.

**Storage location is a hard constraint.** `scripts/backup.sh` runs a full
`pg_dump` *and* tars `MUSIC_LIBRARY_PATH`, and both are mirrored offsite. Cookie
jars must therefore live in **neither**. They go to a new `YT_COOKIES_DIR`
env-configured path, outside the repo and outside the music library, written
mode `600`, and gitignored.

Validation on upload: must parse as Netscape cookie format and contain the
expected YouTube session cookie names. Reject otherwise.

`runYtDlp` takes an optional cookie path and appends `--cookies <path>` when
present; when absent the flag is omitted entirely (current behaviour).

Expiry surfaces as a yt-dlp failure mentioning login or bot-check. On detection,
mark the jar stale and show "Reconnect" in Settings. Cookie contents are never
logged, and yt-dlp stderr is scrubbed before it reaches `errorMessage`.

## Security posture

Stated plainly so it isn't rediscovered later:

- A YouTube `cookies.txt` contains live Google account credentials
  (`__Secure-1PSID`, `SAPISID`, et al). Anyone with the file can act as that
  Google account. They cannot be scoped down to YouTube-only.
- `mu_name` is an unsigned plain cookie and `auth.ts` documents it as not
  security-relevant. Either person can select the other's cookie jar by editing
  it. Per-user jars are a **convenience** boundary, not an isolation boundary.
- Driving automated downloads through a logged-in account carries a real risk
  of YouTube rate-limiting or banning that account. A throwaway Google account
  limits the blast radius.

These were raised before the decision; per-user upload was chosen with them in
view.

## Error handling

- Preview fetch fails → error state in the picker with the yt-dlp message, retry
  button. Nothing was written, so there is nothing to clean up.
- Preview returns zero entries → "This link didn't resolve to a playlist",
  no navigation.
- Individual download fails → `YtCacheEntry.status = FAILED`, surfaced in the
  Downloads tab with retry. The chain continues to the next item.
- Server restart mid-chain → existing `resetStuckDownloads` marks orphaned
  `DOWNLOADING` rows FAILED at boot; they appear in the Failed section as
  retryable.
- Stale cookies → jar marked stale, Settings prompts reconnect, downloads fall
  back to anonymous rather than hard-failing.

## Testing

Unit tests against a mocked `runYtDlp`:

- `classifyListUrl` prefix table, including `RDMM`/`RDAMVM` and unknown prefixes.
- Dedupe preserves first-occurrence order.
- `--playlist-end` is passed for mixes and absent for playlists.
- Cookie path resolution; no `--cookies` flag when no jar exists.
- Netscape validator accept and reject cases.
- **Regression: `previewPlaylist` performs zero DB writes.** This is the
  property the current implementation violates.

`vitest.config.ts` and `tests/` already exist. yt-dlp network behaviour is not
unit-testable; `runYtDlp` is the mock boundary.

## Open items

- The `defaultCheckedCount = 20` heuristic should be revisited once there's real
  usage data across different seeds.
- If pruning still feels like too much work after cookies land, revisit whether
  the mix cap can drop below 40.
