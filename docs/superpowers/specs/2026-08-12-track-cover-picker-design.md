# Per-Track Cover Picker + Re-transcribe in Track Menu — Design

**Date:** 2026-08-12
**Status:** Approved

## Problem

Cover art is frequently wrong or badly cropped, and there is no way to fix it.

Two distinct causes:

1. **Wrong cover.** The metadata worker matches a MusicBrainz release and takes
   its Cover Art Archive front image. A bad match gives a confidently wrong
   cover with no recourse.
2. **Doesn't fit.** Tracks with no album art fall back to
   `i.ytimg.com/vi/<id>/hqdefault.jpg`, which is **16:9**. Every cover surface
   in the app is square and uses `object-cover`, so the thumbnail is
   centre-cropped — losing exactly the edges where video thumbnails put their
   subject and title text.

Compounding both: cover art is stored on `Album`, and **every YouTube download
by the same artist is upserted into a single shared album titled "YouTube"**
(`yt-download.ts`, `album.upsert({ where: { artistId_title: { artistId, title:
"YouTube" } } })`). So album-level art is the wrong granularity for YT tracks —
one fix would repaint every song by that artist.

Separately, Re-transcribe exists only as a header button inside `LyricsPanel`,
reachable only for the currently-playing track.

## Decisions

| Question | Decision |
|---|---|
| Where do replacement covers come from? | Candidate picker (existing images only) — not upload |
| Where is the choice stored? | Per-track override |
| Does Re-transcribe leave the lyrics panel? | No — added to the menu, panel button stays |
| Candidate cap | 8 |
| Entry points | Track menu only for now |

### Known limitation of the candidate approach

A picker can only offer images that already exist. For well-known tracks the
Cover Art Archive has plenty; for obscure ones it returns nothing and the only
remaining candidates are the same 16:9 YouTube thumbnail at different
resolutions. If that proves common in practice, the fix is upload — explicitly
deferred, not designed around.

## Architecture

### 1. Data

Migration adds a nullable `coverArtHash` to `Track`. Resolution order:

```
track.coverArtHash  →  album.coverArtHash  →  https://i.ytimg.com/vi/<id>/hqdefault.jpg  →  null
```

`coverUrl(hash, ytVideoId)` keeps its signature; callers pass the already-resolved
hash. Resolution happens where tracks are read.

**Trap to avoid:** `buildQueueTrack` currently computes
`coverArtHash: t.album?.coverArtHash ?? t.coverArtHash ?? null` — album first.
Silently flipping that order would change behaviour for every existing caller,
several of which pass `coverArtHash` meaning *album* art. A new explicit
`trackCoverArtHash` field is added instead, and it takes precedence:

```ts
coverArtHash: t.trackCoverArtHash ?? t.album?.coverArtHash ?? t.coverArtHash ?? null
```

### 2. Candidate sources

New `src/server/services/cover-candidates.ts`:

- **MusicBrainz → Cover Art Archive.** `searchRecording(artist, title)` currently
  keeps only `releases[0]` per recording; it is widened to return every release.
  Releases are deduped by `releaseMbid` and capped at 8. Each yields a
  `coverartarchive.org/release/<mbid>/front-250` thumbnail for the grid and
  `front-500` on commit.
- **YouTube variants** when the track has a `ytVideoId`: `maxresdefault`
  (sharper than the `hqdefault` used today) and `hqdefault`, both labelled 16:9
  so the cropping is self-explanatory.
- **Current art**, flagged `isCurrent` so the UI can mark it.

Previews load client-side straight from those URLs — the same plain `<img>`
pattern already used for `i.ytimg.com`. No server proxying. CAA 404s are common
and are hidden via `onError`.

MusicBrainz calls go through the existing 1 req/sec `PQueue`, so a picker open
costs one queued request.

### 3. Commit path

Server actions in `src/server/actions/cover.ts`:

- `listCoverCandidates(trackId): Promise<CoverCandidate[]>`
- `setTrackCover(trackId, imageUrl)` — fetch, SHA-256, write
  `MUSIC_LIBRARY_PATH/.cache/art/<hash>.jpg`, set `Track.coverArtHash`. Reuses
  the storage layout `fetchCoverArt` already writes to, so `/api/art/<hash>`
  and its immutable caching work unchanged.
- `clearTrackCover(trackId)` — revert to album / YouTube art.

**`imageUrl` is host-allowlisted to `coverartarchive.org`, `*.coverartarchive.org`
and `i.ytimg.com`, https only.** Without this, `setTrackCover` is an arbitrary
server-side fetcher pointed at whatever a client sends — an SSRF hole into the
LAN this machine sits on. Response size is capped and content-type must be an
image.

### 4. UI

`TrackMenu` gains two items above the delete separator:

- **Re-transcribe** — calls the same `transcribeTrack` action the lyrics panel
  uses. Whisper is slow, so the item shows a busy state and reports the outcome
  rather than closing silently. Hidden when the track has no local file, since
  there would be nothing to transcribe.
- **Change cover…** — opens `CoverPickerDialog`.

The kebab dropdown is 224px wide, far too narrow for an image grid, so the
picker is a modal following the existing `KeyboardHelpDialog` pattern (fixed
overlay, backdrop click and Esc to close, stopPropagation on the panel).

`LyricsPanel` is unchanged — its Re-transcribe button stays exactly where it is.
The two placements serve different moments: "these lyrics are wrong while I'm
reading them" versus "fix this song I'm not playing".

### 5. Error handling

- No candidates → an explicit "no cover art found for this track" message.
  This is a real outcome of the candidate approach, not a failure.
- Individual CAA thumbnail 404 → that tile hides itself.
- `setTrackCover` rejects a disallowed host, a non-image content-type, or an
  oversized response, and surfaces the reason.
- Re-transcribe failure surfaces the error instead of silently closing.

### 6. Testing

- `resolveCoverHash` precedence: track override wins over album, album over
  none; `buildQueueTrack` ordering including the legacy `coverArtHash` field.
- `isAllowedCoverHost`: accepts CAA and `i.ytimg.com` over https, rejects other
  hosts, http, and credential-embedding URLs.
- Candidate dedupe by `releaseMbid` and the cap of 8.
- `searchRecording` returning multiple releases per recording.

## Out of scope

- Uploading an arbitrary image (revisit if CAA coverage proves too thin).
- A "change cover" entry point in the now-playing panel.
- Applying a chosen cover to a whole album.
