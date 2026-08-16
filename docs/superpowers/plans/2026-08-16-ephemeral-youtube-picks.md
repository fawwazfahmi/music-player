# Ephemeral YouTube Picks + Taste-Seeded Mood Reach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play YouTube songs as an ephemeral "trying it out" state (woven into mood mixes at random spots + direct picks), adopt them into the library via a nudge/keep, taste-seed the YouTube search from her top library tracks for the mood, and sweep un-kept tries after 7 days.

**Architecture:** A new `Track.inLibrary` boolean makes library membership orthogonal to `source`/`playable`. Ephemeral picks are `YT_CACHED, playable:true, inLibrary:false` — playable but hidden from every library list. Adoption flips the flag. YouTube picking is seeded from the mood's top-fit library tracks.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Prisma 7 + PostgreSQL, Zustand, Tailwind v4, Vitest, pnpm.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (this is a modified Next.js — see AGENTS.md).
- Tests hit the **live Postgres** — namespace all test data (`zt-`/`ztest-` prefixes) and delete it in cleanup.
- Never invent artist/title data (grounded-only) — not relevant here but keep the bar.
- After each task: the affected tests pass, `pnpm exec tsc --noEmit` is clean.
- Final: full `pnpm exec vitest run` green, then `./scripts/deploy.sh` (rebuild + kickstart + CSS-200 verify).
- Prisma maps `inLibrary` → column `"inLibrary"` (no `@map`); raw SQL in `search.ts` must quote it.

---

### Task 1: `inLibrary` flag + migration

**Files:**
- Modify: `prisma/schema.prisma` (model `Track`)
- Test: `tests/server/in-library-flag.test.ts`

**Interfaces:**
- Produces: `Track.inLibrary: boolean` (`@default(true)`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/in-library-flag.test.ts
import { describe, expect, it, afterAll } from "vitest";
import { db } from "@/server/db";

const IDS: string[] = [];
afterAll(async () => {
  await db.track.deleteMany({ where: { id: { in: IDS } } });
  await db.artist.deleteMany({ where: { name: "ztest-inlib-artist" } });
});

describe("Track.inLibrary", () => {
  it("defaults to true for a normally-created track", async () => {
    const artist = await db.artist.upsert({
      where: { name: "ztest-inlib-artist" },
      create: { name: "ztest-inlib-artist" },
      update: {},
    });
    const t = await db.track.create({
      data: { title: "ztest-inlib", duration: 1, primaryArtistId: artist.id },
    });
    IDS.push(t.id);
    expect(t.inLibrary).toBe(true);
  });

  it("can be created ephemeral", async () => {
    const artist = await db.artist.findUniqueOrThrow({ where: { name: "ztest-inlib-artist" } });
    const t = await db.track.create({
      data: { title: "ztest-inlib-eph", duration: 1, primaryArtistId: artist.id, inLibrary: false },
    });
    IDS.push(t.id);
    expect(t.inLibrary).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect a compile/type failure** (`inLibrary` unknown).

Run: `pnpm exec vitest run tests/server/in-library-flag.test.ts`

- [ ] **Step 3: Add the field**

In `prisma/schema.prisma`, model `Track`, next to `playable`:

```prisma
  playable  Boolean     @default(true)
  inLibrary Boolean     @default(true)
```

- [ ] **Step 4: Create + apply the migration**

Run: `pnpm exec prisma migrate dev --name add_track_in_library`

- [ ] **Step 5: Run the test, expect PASS.**

- [ ] **Step 6: Commit** — `feat(schema): add Track.inLibrary flag`

---

### Task 2: Ephemeral download path + `adoptTrack`

**Files:**
- Modify: `src/server/services/yt-download.ts` (`createPendingDownload`)
- Create: `src/server/actions/library.ts` (`adoptTrack`)
- Test: `tests/server/ephemeral-download.test.ts`, `tests/server/adopt-track.test.ts`

**Interfaces:**
- Consumes: `createPendingDownload(result: YtSearchResult, opts?: { ephemeral?: boolean }): Promise<{trackId, cached}>`
- Produces: `adoptTrack(trackId: string): Promise<void>` — sets `inLibrary:true`, idempotent.

- [ ] **Step 1: Write the failing test for the ephemeral flag**

```ts
// tests/server/ephemeral-download.test.ts — verifies createPendingDownload({ephemeral:true})
// creates the Track with inLibrary:false. Use a ztest- videoId; afterAll delete the
// Track by ytVideoId + its YtCacheEntry + MetadataJob + artist/album by ztest name.
```
(Assert `(await db.track.findUnique({where:{ytVideoId}})).inLibrary === false`.)

- [ ] **Step 2: Run it, expect FAIL** (opts param not supported / defaults true).

- [ ] **Step 3: Thread the flag through `createPendingDownload`**

Add `opts: { ephemeral?: boolean } = {}`; when creating/refreshing the `Track`, set `inLibrary: opts.ephemeral ? false : true`. Do the same on the "adopt already-on-disk file" branch. Leave `runDownloadJob`/`enrichTrackExtras` untouched (enrichment still runs).

- [ ] **Step 4: Run test, expect PASS.**

- [ ] **Step 5: Write the failing test for `adoptTrack`**

```ts
// tests/server/adopt-track.test.ts
// - create an ephemeral track (inLibrary:false) → adoptTrack(id) → inLibrary:true
// - calling adoptTrack again is a no-op (still true, no throw)
// - adoptTrack on a non-existent id resolves without throwing
```

- [ ] **Step 6: Run it, expect FAIL** (module missing).

- [ ] **Step 7: Implement `adoptTrack`**

```ts
// src/server/actions/library.ts
"use server";
import { db } from "@/server/db";
import { revalidatePath } from "next/cache";

export async function adoptTrack(trackId: string): Promise<void> {
  const t = await db.track.findUnique({ where: { id: trackId }, select: { inLibrary: true } });
  if (!t || t.inLibrary) return;
  await db.track.update({ where: { id: trackId }, data: { inLibrary: true } });
  revalidatePath("/");
}
```
(Mood-signal-on-adopt is wired in Task 6 where the session context exists.)

- [ ] **Step 8: Run tests, expect PASS.**

- [ ] **Step 9: Commit** — `feat(yt): ephemeral downloads + adoptTrack action`

---

### Task 3a: Library filtering — views + genres

**Files:**
- Modify: `src/server/actions/views.ts` (`getAllSongs`, `getAllAlbums`, `getArtists`, `getTracksByAlbum`, `getTracksByArtist`), `src/server/actions/genres.ts` (`getAllGenres`, `getTracksByGenre`)
- Test: `tests/server/library-excludes-ephemeral.test.ts`

**Interfaces:**
- Consumes: `Track.inLibrary` (Task 1).
- Produces: every library list excludes `inLibrary:false`; artists/albums/genres with zero in-library tracks disappear.

- [ ] **Step 1: Write the failing test**

```ts
// Seed: one library track + one ephemeral track (inLibrary:false), each with its
// own ztest artist/album/genre. Assert:
//  - getAllSongs() contains the library track id, NOT the ephemeral id
//  - getArtists() includes the library artist, NOT the ephemeral-only artist
//  - getAllAlbums() excludes the ephemeral-only album
//  - getAllGenres() excludes a genre held only by the ephemeral track
// afterAll: delete seeded rows.
```

- [ ] **Step 2: Run it, expect FAIL** (ephemeral leaks into lists).

- [ ] **Step 3: Add `inLibrary: true` to the track-scoped where clauses**

- `getAllSongs`: `where: { playable: true, inLibrary: true }`.
- `getTracksByAlbum`: `where: { albumId, playable: true, inLibrary: true }`.
- `getTracksByArtist`: `where: { primaryArtistId: artistId, playable: true, inLibrary: true }`.

- [ ] **Step 4: Filter artists/albums by in-library tracks and hide zeros**

- `getArtists`: `where: { tracks: { some: { inLibrary: true } } }`; make `_count.tracks` count only in-library (`_count: { select: { tracks: { where: { inLibrary: true } }, albums: true } }`); scope `repTrackSelect`'s `tracks` to `where: { inLibrary: true }` so the rep image comes from a library track.
- `getAllAlbums`: `where: { tracks: { some: { inLibrary: true } } }`; scope its rep-track select to `inLibrary:true`.

- [ ] **Step 5: Filter genres**

- `getAllGenres`: count only in-library tracks — `_count: { select: { tracks: { where: { track: { inLibrary: true } } } } }` (via the `TrackGenre` relation; verify the relation path in schema) — the existing `.filter(trackCount > 0)` then drops empties.
- `getTracksByGenre`: add `track: { inLibrary: true }` to its where.

- [ ] **Step 6: Run test, expect PASS. Run `tsc`.**

- [ ] **Step 7: Commit** — `feat(library): hide ephemeral tracks from browse views`

---

### Task 3b: Library filtering — search + stats

**Files:**
- Modify: `src/server/services/search.ts` (`searchLibrary` raw SQL), `src/server/actions/stats.ts` (aggregations)
- Test: `tests/server/search-excludes-ephemeral.test.ts`

**Interfaces:**
- Produces: library search + stats exclude `inLibrary:false`.

- [ ] **Step 1: Write the failing test** — seed a library + ephemeral track whose titles share a unique ztest token; `searchLibrary("ztest-token")` returns only the library one. (Stats: assert `getTopTracks` after a completed play on the ephemeral track does not list it — or, if simpler/robust, assert the SQL/query filters by inLibrary via a smaller unit.)

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Patch `searchLibrary` raw SQL** — every track `WHERE` gets `AND t."inLibrary" = true` (note the quoted camelCase column). Check both the track CTE and any album/artist joins that derive from tracks.

- [ ] **Step 4: Patch `stats.ts`** — the `listeningHistory` aggregations join/where on `track: { inLibrary: true }` (or filter grouped trackIds against in-library tracks) for `getTopTracks`, `getTopArtists`, `getTopAlbums`, `getRecentlyPlayed`, `getStatsOverview`.

- [ ] **Step 5: Run test, expect PASS. Run `tsc`.**

- [ ] **Step 6: Commit** — `feat(library): exclude ephemeral from search + stats`

---

### Task 4: Taste-seeded `suggestYtForMood`

**Files:**
- Create: `src/lib/yt-taste-query.ts` (pure helpers)
- Modify: `src/server/services/mood-yt.ts` (`suggestYtForMood`), `src/server/actions/moods.ts` (`getMoodYtSuggestions`)
- Test: `tests/lib/yt-taste-query.test.ts`, `tests/server/mood-yt.test.ts`

**Interfaces:**
- Produces:
  - `buildTasteQueries(input: { moodLabel: string; seedArtists: string[]; seedGenres: string[] }): string[]`
  - `interleaveFresh(lists: YtSearchResult[][], opts: { limit: number; excludeVideoIds: Set<string>; downrankArtists: string[] }): YtSearchResult[]`
  - `deriveSeeds(seedTracks: SeedTrack[]): { seedArtists: string[]; seedGenres: string[] }`
  - `suggestYtForMood(params: { moodLabel; genreHints; limit?; seedTracks?: SeedTrack[]; downrankArtists?: string[] }, deps?): Promise<YtSearchResult[]>`
  - `interface SeedTrack { artist: string; genres: string[]; fit: number }`

- [ ] **Step 1: Write failing pure tests**

```ts
// tests/lib/yt-taste-query.test.ts
import { describe, expect, it } from "vitest";
import { buildTasteQueries, interleaveFresh, deriveSeeds } from "@/lib/yt-taste-query";

describe("deriveSeeds", () => {
  it("takes top-3 distinct artists and top-2 genres by fit order", () => {
    const seeds = deriveSeeds([
      { artist: "Mr. Kitty", genres: ["darkwave"], fit: 0.9 },
      { artist: "Mr. Kitty", genres: ["darkwave"], fit: 0.8 },
      { artist: "Cavetown", genres: ["indie"], fit: 0.7 },
      { artist: "VÖJ", genres: ["phonk"], fit: 0.6 },
      { artist: "Extra", genres: ["pop"], fit: 0.1 },
    ]);
    expect(seeds.seedArtists).toEqual(["Mr. Kitty", "Cavetown", "VÖJ"]);
    expect(seeds.seedGenres).toEqual(["darkwave", "indie"]);
  });
});

describe("buildTasteQueries", () => {
  it("emits artist+mood, genre+mood, and a generic backstop", () => {
    expect(
      buildTasteQueries({ moodLabel: "chill", seedArtists: ["Mr. Kitty"], seedGenres: ["darkwave"] }),
    ).toEqual(["Mr. Kitty chill", "darkwave chill music", "chill music"]);
  });
  it("still yields the generic query with no seeds", () => {
    expect(buildTasteQueries({ moodLabel: "chill", seedArtists: [], seedGenres: [] })).toEqual([
      "chill music",
    ]);
  });
});

describe("interleaveFresh", () => {
  const r = (videoId: string, uploader: string) => ({ videoId, title: videoId, uploader, duration: 1, thumbnail: "" });
  it("round-robins, dedupes, drops excluded + downranked, respects limit", () => {
    const out = interleaveFresh(
      [[r("a", "Mr. Kitty"), r("b", "Mr. Kitty")], [r("c", "Someone"), r("a", "Mr. Kitty")], [r("d", "BadGuy")]],
      { limit: 3, excludeVideoIds: new Set(["b"]), downrankArtists: ["BadGuy"] },
    );
    expect(out.map((x) => x.videoId)).toEqual(["a", "c", "d"].filter((id) => id !== "d")); // d dropped (downranked)
    // → ["a","c"] then no more fresh → length 2
  });
});
```
(Adjust the exact expected arrays once the round-robin order is fixed; keep the properties: round-robin across lists, first-seen wins, `excludeVideoIds` and `downrankArtists` removed, capped at `limit`.)

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement `src/lib/yt-taste-query.ts`**

`deriveSeeds`: iterate `seedTracks` (already fit-ordered), push distinct artists (cap 3) and distinct genres (cap 2). `buildTasteQueries`: `[...seedArtists.map(a => \`${a} ${moodLabel}\`), ...seedGenres.map(g => \`${g} ${moodLabel} music\`), \`${moodLabel} music\`]`. `interleaveFresh`: index-by-index across lists, skip when `videoId` seen / in `excludeVideoIds`, skip when `uploader` (case-insensitive, trimmed of `" - Topic"`) matches any `downrankArtists`, stop at `limit`.

- [ ] **Step 4: Run pure tests, expect PASS.**

- [ ] **Step 5: Write the failing service test**

```ts
// tests/server/mood-yt.test.ts — inject searchYt; provide seedTracks; assert
// suggestYtForMood issues the taste queries (record calls) and returns interleaved
// fresh picks excluding a videoId that a stubbed db lookup marks as in-library.
// Also: empty seedTracks → falls back to the generic "<hint> <mood> music" query.
```
(Inject `searchYt` via `deps`; the in-library exclusion already queries the DB — either stub via a thin `deps.findExistingVideoIds` or seed real ztest tracks and clean up.)

- [ ] **Step 6: Run, expect FAIL.**

- [ ] **Step 7: Rewrite `suggestYtForMood`** to: `deriveSeeds(seedTracks ?? [])` → `buildTasteQueries` (or the legacy generic query when no seeds) → `searchYt` each (limit ~4) → `interleaveFresh` with `excludeVideoIds` from the existing DB lookup + `downrankArtists`. Keep the try/catch → `[]` behavior.

- [ ] **Step 8: Wire `getMoodYtSuggestions`** (`actions/moods.ts`) to pass `seedTracks` = the session's top-fit library tracks (`{artist, genres, fit}` from `selectMoodTracks`'s output — thread the genres through `MoodPlaylistTrack` if not present, or re-select) and `downrankArtists` = artists she's thumbs-downed for the mood.

- [ ] **Step 9: Run tests + `tsc`, expect PASS.**

- [ ] **Step 10: Commit** — `feat(mood): taste-seed YouTube picks from top library tracks`

---

### Task 5: QueueTrack ephemeral flag + weaving

**Files:**
- Modify: `src/stores/player-store.ts` (`QueueTrack`), `src/components/pages/_shared.tsx` (`buildQueueTrack`)
- Create: `src/lib/weave-queue.ts` (pure splice helper)
- Modify: `src/components/pages/MoodPage.tsx` (weave), `src/components/pages/YtPickerPage.tsx` (ephemeral append)
- Test: `tests/lib/weave-queue.test.ts`

**Interfaces:**
- Produces:
  - `QueueTrack.ephemeral?: boolean`
  - `weaveEphemeral(base: QueueTrack[], picks: QueueTrack[], rng: () => number): QueueTrack[]`

- [ ] **Step 1: Write failing pure test**

```ts
// tests/lib/weave-queue.test.ts
import { describe, expect, it } from "vitest";
import { weaveEphemeral } from "@/lib/weave-queue";

const q = (id: string, ephemeral = false) => ({ id, title: id, duration: 1, artist: "a", album: "b", ephemeral });

describe("weaveEphemeral", () => {
  it("inserts every pick and preserves base order", () => {
    const base = [q("1"), q("2"), q("3"), q("4")];
    const picks = [q("y1", true), q("y2", true)];
    const out = weaveEphemeral(base, picks, () => 0.5);
    expect(out.length).toBe(6);
    expect(out.filter((t) => !t.ephemeral).map((t) => t.id)).toEqual(["1", "2", "3", "4"]);
    expect(out.filter((t) => t.ephemeral).map((t) => t.id).sort()).toEqual(["y1", "y2"]);
  });
  it("is deterministic given rng and never inserts at index 0 (keeps a library track first)", () => {
    const base = [q("1"), q("2")];
    const out = weaveEphemeral(base, [q("y", true)], () => 0);
    expect(out[0]!.ephemeral).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `weaveEphemeral`** — copy `base`; for each pick, compute an index in `[1, len]` from `rng()` and splice it in. Never index 0 (first song stays a known library track for a good start).

- [ ] **Step 4: Run pure test, expect PASS.**

- [ ] **Step 5: Add `ephemeral` to `QueueTrack` + `buildQueueTrack`** — add optional `ephemeral?: boolean` to the interface (`player-store.ts:36`) and to `buildQueueTrack`'s input+output (`_shared.tsx`).

- [ ] **Step 6: Wire `YtPickerPage.onPick`** — POST with `ephemeral: true` (route passes it to `createPendingDownload`), build the `QueueTrack` with `ephemeral: true`, and call `usePlayerStore.getState().addToQueue(track)` instead of `setQueue`. Update `/api/yt-download/route.ts` to read `ephemeral` from the body and forward it.

- [ ] **Step 7: Wire `MoodPage`** — after building the library mood queue, call `getMoodYtSuggestions`, `POST /api/yt-download {ephemeral:true}` for each pick (get `trackId`), build ephemeral `QueueTrack`s, `weaveEphemeral(libraryQueue, picks, Math.random)`, then `setQueue(woven, 0)`. Remove/ްretire the old side-list "keep" UI (or leave it; the weave supersedes it — prefer removing the separate suggestions list per the spec's "not just in a list").

- [ ] **Step 8: Run `tsc` + affected tests, expect PASS.**

- [ ] **Step 9: Commit** — `feat(queue): weave ephemeral YouTube picks into mood mixes + direct picks`

---

### Task 6: Adopt nudge + favorite-adopts

**Files:**
- Create: `src/lib/adopt-nudge.ts`, `src/stores/adopt-store.ts`, `src/components/adopt/AdoptNudge.tsx`
- Modify: `src/components/layout/AppShell.tsx` (mount `AdoptNudge`), `src/server/actions/favorites.ts` (`toggleFavorite` adopts an ephemeral track)
- Test: `tests/lib/adopt-nudge.test.ts`, `tests/server/favorite-adopts.test.ts`

**Interfaces:**
- Produces:
  - `shouldShowAdoptNudge(i: { isEphemeral; adopted; dismissed; progress; songsSinceNudge }): boolean`
  - `ADOPT_NUDGE_PROGRESS = 0.6`, `ADOPT_NUDGE_GAP = 3`

- [ ] **Step 1: Write failing predicate test**

```ts
// tests/lib/adopt-nudge.test.ts
import { describe, expect, it } from "vitest";
import { shouldShowAdoptNudge } from "@/lib/adopt-nudge";
const base = { isEphemeral: true, adopted: false, dismissed: false, progress: 0.7, songsSinceNudge: 3 };
describe("shouldShowAdoptNudge", () => {
  it("shows for an un-kept ephemeral track past the thresholds", () => {
    expect(shouldShowAdoptNudge(base)).toBe(true);
  });
  it("never shows for a library track, or once adopted/dismissed", () => {
    expect(shouldShowAdoptNudge({ ...base, isEphemeral: false })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, adopted: true })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, dismissed: true })).toBe(false);
  });
  it("waits for progress and the gap", () => {
    expect(shouldShowAdoptNudge({ ...base, progress: 0.3 })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, songsSinceNudge: 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement `adopt-nudge.ts`** (mirror `mood-nudge.ts`). **Step 4: Run, expect PASS.**

- [ ] **Step 5: Implement `adopt-store.ts`** — `useAdoptStore` with `dismissed: Set<string>`, `adopted: Set<string>`, `dismiss(id)`, `markAdopted(id)`. (No persistence needed; session-scoped.)

- [ ] **Step 6: Implement `AdoptNudge.tsx`** — mirror `MoodNudge.tsx`: read current track from `usePlayerStore`, compute `progress` from `position/duration`, keep a `sinceNudge` gap counter incremented on track change, and when `shouldShowAdoptNudge({ isEphemeral: currentTrack.ephemeral, adopted, dismissed, progress, songsSinceNudge })` render the bar: *"Feeling this one? Add it to Kyowave"* [Add] [Not now]. **Add** → `await adoptTrack(id)`, `markAdopted(id)`, mark the queue track non-ephemeral (`usePlayerStore` setter or re-fetch), toast; **Not now** → `dismiss(id)`, reset gap.

- [ ] **Step 7: Mount `AdoptNudge`** in `AppShell.tsx` beside `MoodNudge`. Verify build in the browser (Task 8).

- [ ] **Step 8: Write failing favorite-adopts test**

```ts
// tests/server/favorite-adopts.test.ts — favoriting an ephemeral track flips inLibrary
// to true (adopts); favoriting a library track behaves as before. afterAll cleanup.
```

- [ ] **Step 9: Run, expect FAIL. Step 10:** In `toggleFavorite`, when `kind === "TRACK"` and we are *adding* a favorite, load the track; if `inLibrary === false`, `await adoptTrack(id)` before/after creating the favorite. **Step 11: Run, expect PASS.**

- [ ] **Step 12: Wire mood-signal-on-adopt** — when adoption happens inside a mood session (the nudge/keep knows the `sessionId` from `useMoodLearningStore`), also call the existing `adoptYtPickIntoMood(sessionId, trackId)` so keeping teaches taste. (Client-side call from the nudge/favorite handler; no server coupling.)

- [ ] **Step 13: `tsc` + tests green. Commit** — `feat(adopt): nudge + keep-to-adopt for ephemeral picks`

---

### Task 7: Cleanup sweep

**Files:**
- Create: `src/lib/ephemeral-stale.ts` (pure predicate), `src/server/services/ephemeral-sweeper.ts`
- Modify: `src/instrumentation.ts` (start the sweeper)
- Test: `tests/lib/ephemeral-stale.test.ts`, `tests/server/ephemeral-sweeper.test.ts`

**Interfaces:**
- Produces:
  - `isEphemeralStale(i: { inLibrary: boolean; createdAt: Date; lastPlayedAt: Date | null; now: Date; days?: number }): boolean`
  - `cleanupEphemeralTracks(deps?): Promise<{ removed: number }>`
  - `startEphemeralSweeper(): void`

- [ ] **Step 1: Write failing predicate test**

```ts
// tests/lib/ephemeral-stale.test.ts
import { describe, expect, it } from "vitest";
import { isEphemeralStale } from "@/lib/ephemeral-stale";
const now = new Date("2026-08-16T00:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86400_000);
describe("isEphemeralStale", () => {
  it("stale when un-kept, old, and not played in 7d", () => {
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: days(8), now })).toBe(true);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: null, now })).toBe(true);
  });
  it("not stale if in library, recently created, or recently played", () => {
    expect(isEphemeralStale({ inLibrary: true, createdAt: days(10), lastPlayedAt: days(8), now })).toBe(false);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(2), lastPlayedAt: null, now })).toBe(false);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: days(1), now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement `ephemeral-stale.ts`** — stale ⇔ `!inLibrary && age(createdAt) ≥ days && (lastPlayedAt == null || age(lastPlayedAt) ≥ days)`, `days` default 7. **Step 4: Run, expect PASS.**

- [ ] **Step 5: Write failing sweeper test**

```ts
// tests/server/ephemeral-sweeper.test.ts — seed a stale ephemeral track (backdate
// createdAt), a fresh ephemeral track, and a library track; run cleanupEphemeralTracks
// with an injected file-deleter (deps) so no real disk I/O; assert only the stale
// ephemeral row is deleted and the deleter was called with its filePath. afterAll cleanup.
```

- [ ] **Step 6: Run, expect FAIL.**

- [ ] **Step 7: Implement `cleanupEphemeralTracks(deps = { unlink, now })`** — find `inLibrary:false` tracks; for each, compute `lastPlayedAt` (max `ListeningHistory.playedAt`); if `isEphemeralStale`, `await deps.unlink(filePath)` (best-effort), then `db.track.delete` (cascades `YtCacheEntry`/history). Return count. `console.log` the number removed.

- [ ] **Step 8: Implement `startEphemeralSweeper`** — `setInterval` (~6h) + one run shortly after boot; guard against double-start (module singleton like `metadata-worker`).

- [ ] **Step 9: Register in `instrumentation.ts`** — import and call `startEphemeralSweeper()` inside `register()` (nodejs runtime only), logging `[mu] ephemeral sweeper started`.

- [ ] **Step 10: Run tests + `tsc`, expect PASS. Commit** — `feat(cleanup): sweep un-kept ephemeral picks after 7 days`

---

### Task 8: Final verification + deploy

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm exec tsc --noEmit` — clean.
- [ ] **Step 2:** `pnpm exec vitest run` — full suite green. Fix any regressions (esp. tests that assumed old library-list contents).
- [ ] **Step 3:** Snapshot library integrity (track/artist/album counts) before and after to confirm no accidental data loss.
- [ ] **Step 4:** `./scripts/deploy.sh` — build + kickstart + health + CSS-200.
- [ ] **Step 5: Browser-verify** (mint session cookie, per prior sessions): run a mood mix and confirm YouTube picks appear inline in the queue (not a side list); play one past 60% and confirm the "Add it to Kyowave" nudge appears; click Add and confirm it stops being ephemeral and shows in Songs; confirm an un-adopted pick is absent from Songs/Artists/Albums.
- [ ] **Step 6:** Finish the branch — REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch`.

---

## Self-review

- **Spec coverage:** `inLibrary` (T1) · ephemeral download + adopt (T2) · library hiding across views/genres/search/stats (T3a/T3b) · taste-seeded picks (T4) · queue weave + direct pick (T5) · adopt nudge + keep + mood-signal (T6) · 7-day cleanup (T7) · verify/deploy (T8). All spec sections mapped.
- **Type consistency:** `SeedTrack` defined in T4 and consumed by `getMoodYtSuggestions`; `QueueTrack.ephemeral` defined T5 and read by `AdoptNudge` T6; `adoptTrack` defined T2, used T5/T6; `createPendingDownload(opts)` defined T2, used T5.
- **Open verification during impl:** the exact `TrackGenre` relation path for the `getAllGenres` in-library count (T3a Step 5) and the `stats.ts` join shape (T3b Step 4) — confirm against the schema when implementing; the intent (count/aggregate only `inLibrary:true`) is fixed.
- **Namespacing:** every DB test uses `ztest-`/`zt-` names and cleans up (live-Postgres constraint).
