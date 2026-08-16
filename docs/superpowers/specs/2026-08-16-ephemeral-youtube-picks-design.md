# Ephemeral YouTube Picks + Taste-Seeded Mood Reach — Design

**Date:** 2026-08-16
**Status:** Approved (design), pending implementation plan

## Goal

Let YouTube songs enter the **playing queue** as a temporary "trying it out" state
— woven into mood mixes at random spots and added by direct YouTube search picks —
and only join the library ("Kyowave") when the listener adopts them. Make the
YouTube picks **taste-aware** (seeded from what she already likes for that mood),
not a generic `"<mood> music"` search.

## Background (current behavior)

- The app is **download-to-play**: there is no true YouTube streaming. A pick is
  downloaded to an `.m4a` before any audio plays (`yt-download.ts`
  `createPendingDownload` → `runDownloadJob`). The muted YouTube iframe is only
  the video visual.
- Picking a YT result today (`YtPickerPage.onPick`) downloads it, makes it a
  **permanent** library `Track` immediately, and **replaces** the queue
  (`setQueue([one], 0)`).
- Mood YT suggestions (`suggestYtForMood`) are a generic search
  (`"<genreHint> <mood> music"`), shown as a **side list** on `MoodPage`, adopted
  one-by-one via `keep()`.
- Library mood picks (`selectMoodTracks`) are already personalized: a `fit` score
  per library track blending an audio **seed** with her **learned** per-mood
  affinity, plus favorite/genre/recency/thumbs-down adjustments.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Repeat-play auto-adopt | **Off** — only a thumbs-up/keep or the nudge's "Add" adopts. |
| Where ephemeral picks apply | **Both** mood mixes (random weave) and direct YouTube search picks. |
| Cleanup of un-kept picks | **Delete after 7 days** of no play, not adopted (background sweep). |
| YouTube pick quality | **Taste-seeded** from her top library tracks for the mood; graceful cold-start fallback. |
| Playlists | **Unchanged** — `?list=` still routes to the deliberate playlist picker (permanent). |

## Architecture

### 1. Data model — the `inLibrary` flag

Add to `Track`:

```prisma
inLibrary Boolean @default(true)
```

- Library membership, **orthogonal** to `source`/`playable`. An ephemeral pick is
  `source: YT_CACHED, playable: true, inLibrary: false` — fully playable, just not
  "in Kyowave".
- `@default(true)` → all existing tracks stay in the library; no data backfill.
- Cleanup uses the existing `Track.createdAt` and `ListeningHistory.playedAt`
  (no new timestamp column).
- Migration name: `add_track_in_library`.

### 2. Ephemeral download path

`createPendingDownload(result, opts?: { ephemeral?: boolean })` in `yt-download.ts`:
- `ephemeral: true` → new/refreshed `Track` gets `inLibrary: false`.
- Default `false` (permanent) preserves the playlist-download callers.
- `runDownloadJob` still runs `enrichTrackExtras` (title clean + genre + audio +
  mood seed) even for ephemeral tracks — so they display cleanly and, if adopted,
  are already enriched. Enrichment writing mood **seeds** for an ephemeral track is
  harmless (seeds are listener-agnostic; they only matter once it's in the library
  and surfaced).

`adoptTrack(trackId)` — new server action:
- Sets `inLibrary: true` (file already on disk → instant).
- If called inside a mood session, also applies the existing `favorite` mood
  signal (reuse `adoptYtPickIntoMood`'s path) so adoption teaches taste.
- `revalidatePath` the library views.
- Idempotent (adopting an already-in-library track is a no-op).

### 3. Taste-seeded YouTube picking — smarter `suggestYtForMood`

New signature:

```ts
interface SeedTrack { artist: string; genres: string[]; fit: number }
suggestYtForMood(
  params: { moodLabel: string; genreHints: string[]; limit?: number; seedTracks?: SeedTrack[]; downrankArtists?: string[] },
  deps?: { searchYt? }
): Promise<YtSearchResult[]>
```

Algorithm:
1. **Derive seeds** from `seedTracks` (the `fit`-ranked top library tracks the mood
   flow already computes):
   - `seedArtists` = distinct artists of the highest-fit tracks, capped at 3.
   - `seedGenres` = distinct top genres among them ∪ `genreHints`, capped at 2.
2. **Build queries** (in priority order):
   - per seed artist → `"<artist> <moodLabel>"`
   - per seed genre → `"<genre> <moodLabel> music"`
   - always append generic `"<moodLabel> music"` backstop.
3. **Search each** (small per-query limit), **interleave round-robin** so picks
   aren't all one artist, favouring earlier (higher-fit) seeds.
4. **Filter:** drop in-library videoIds (existing DB check), dedupe by videoId, and
   drop results whose channel/artist matches `downrankArtists` (her mood
   thumbs-downs). Take `limit` (default 4).
5. **Cold start:** empty `seedTracks` → the current generic
   `"<genreHint> <mood> music"` query. Any search throw → `[]`. Never blocks.

Pure query-building and merge/dedupe/filter logic is factored into small helpers
in `src/lib/` for unit testing; the network `searchYt` is injected.

`getMoodYtSuggestions(sessionId)` in `actions/moods.ts` passes the session's
top-fit library tracks (already selected) as `seedTracks`, and her mood
thumbs-down artists as `downrankArtists`.

### 4. Weaving into the queue

**QueueTrack** (`player-store.ts`) gains `ephemeral?: boolean` (true when
`inLibrary === false`). `buildQueueTrack` accepts/propagates it. Playback is
unchanged (audio route serves the file once ready; 425-retry already handles the
brief download gap).

**Mood mix** (`MoodPage`): after building the library queue, fetch the
taste-seeded YT picks, `createPendingDownload(..., { ephemeral: true })` for each
(returns a real `trackId` immediately), build ephemeral `QueueTrack`s, and
**splice them at random indices** into the queue (seeded RNG injectable for tests;
`Math.random` in app code). Picks that are still downloading play via the normal
425-retry path when reached.

**Direct pick** (`YtPickerPage.onPick`): `createPendingDownload(..., { ephemeral:
true })` then `addToQueue(ephemeralQueueTrack)` (append) instead of
`setQueue`.

### 5. The adopt nudge

Mirror the mood-nudge pattern exactly:
- `src/lib/adopt-nudge.ts` — pure `shouldShowAdoptNudge(input)` predicate:
  show when `isEphemeral && !adopted && !dismissed && progress >= 0.6 &&
  songsSinceNudge >= NUDGE_GAP`.
- `src/stores/adopt-store.ts` — session state: `dismissed: Set`, `adopted: Set`,
  `sinceNudge` counter; `dismiss(trackId)`, `markAdopted(trackId)`.
- `src/components/adopt/AdoptNudge.tsx` — globally mounted (beside `MoodNudge`),
  driven by player position + gap counter. Copy: *"Feeling this one? Add it to
  Kyowave"* with **[Add]** (→ `adoptTrack` + toast, `markAdopted`) and **[Not
  now]** (→ `dismiss`).
- **Thumbs-up / keep** on an ephemeral track (the existing track favorite,
  `FavoriteTrack`) also calls `adoptTrack`.

### 6. Library filtering (the broad surface)

Every "this is my library" read gains `where: { inLibrary: true }` (or the
relation-filtered equivalent) so ephemeral tries never leak:

- `views.ts`: `getAllSongs`, `getAllAlbums`, `getArtists`, `getAllGenres` — and
  artists/albums must count **only** in-library tracks and hide those left with
  zero (no phantom artist/album from an ephemeral-only pick).
- `search` service / `searchLibrary` — library results exclude ephemeral (YouTube
  search is the discovery path for those).
- `stats.ts` aggregations — "top/recent" restricted to in-library tracks.
- Home — inherits the above via the same view functions.
- **Not filtered:** the queue, the audio route, playback history recording, and
  the mood engine's candidate pool (an ephemeral pick can still be played, seeded,
  and reacted to; it's just not *listed* as library).

### 7. Cleanup sweep

- `cleanupEphemeralTracks(deps?)` — selects `inLibrary: false` tracks whose
  `createdAt` and latest `ListeningHistory.playedAt` are both older than 7 days,
  deletes the file from disk, then the `Track` row (+ cascade `YtCacheEntry`,
  history). Pure "is stale" predicate is unit-tested; the sweep is integration
  behavior.
- Wired into the existing periodic worker (same place the metadata worker runs);
  fallback: run on server boot + a daily interval. Logs how many it removed (no
  silent bulk delete).

## Testing strategy (TDD)

- **Pure/unit (no DB, no network):** query-building + interleave/dedupe/filter for
  `suggestYtForMood`; `shouldShowAdoptNudge`; the stale-track predicate; the
  random-splice helper (with injected RNG).
- **Server/DB:** `adoptTrack` (flips flag, idempotent, applies mood signal in a
  session); `createPendingDownload({ ephemeral })` sets `inLibrary:false`; each
  library view/query excludes ephemeral and hides zeroed artists/albums;
  `cleanupEphemeralTracks` deletes only the right rows/files. Namespace test data
  (tests hit the live Postgres — see project convention) and clean up.
- **Existing suite stays green**; `tsc` clean; deploy verifies CSS 200.

## Out of scope (YAGNI)

- True YouTube audio streaming (project decision: download-to-play).
- Auto-adopt on repeat (explicitly off).
- Ephemeral picks in playlists (playlists remain deliberate/permanent).
- A dedicated "recently tried" browse page — ephemeral picks live in the queue
  only; cleanup handles the rest.
