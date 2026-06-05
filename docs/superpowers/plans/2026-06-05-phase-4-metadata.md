# Music Universe — Phase 4: Metadata Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Real artist names, real album titles, real cover art. When a track is added (local scan OR YT pick), look it up in MusicBrainz, refine the metadata, fetch cover art, and update the iPod screens.

**Architecture:**
1. **MusicBrainz service** — `searchRecording(artist, title)` queries MB's `/ws/2/recording` endpoint, returns ranked candidates. Rate-limited to 1 req/sec via `p-queue` (their etiquette policy).
2. **Cover Art Archive service** — `getCoverArt(releaseMbid)` fetches the front cover, saves to `MUSIC_LIBRARY_PATH/.cache/art/<sha256>.jpg`, returns hash for serving.
3. **Enrichment worker** — Drains `MetadataJob` queue rows. Each job: query MB → if confident match (score ≥85) write Track.mbid + refined Artist/Album + enqueue cover art fetch → mark DONE. If ambiguous (multiple ≥70 candidates) mark FAILED with `multi-match` flag.
4. **Ingest integration** — `ingestFile()` enqueues a MetadataJob row for every new track. Existing tracks (without `metadataFetched`) get backfilled on next worker tick.
5. **`/api/art/[hash]` route** — Serves cover art files from `.cache/art/` with proper MIME type + caching headers.
6. **UI** — NowPlaying + AlbumDetail + ArtistDetail show real cover art when available, with the existing gradient as a fallback.

**Tech Stack:** No new deps (uses native `fetch` + `p-queue` from Phase 2 + Prisma).

**Reference:** Spec §4 (metadata pipeline), §6 (server actions), §7 Phase 4.

---

## Prerequisites

- Phase 3 merged to `main` (`24fd429`) + fixes through `5781994` etc.
- `MUSICBRAINZ_USER_AGENT` set in `.env` (already there).
- Internet connection to reach `musicbrainz.org` and `coverartarchive.org`.
- Branch: create `phase-4-metadata` off `main`.

---

## File Structure (Phase 4 additions)

```
src/
├─ app/api/art/[hash]/route.ts             # CREATE — serve cover art files
├─ server/
│  ├─ services/
│  │  ├─ musicbrainz.ts                    # CREATE — MB recording/artist search
│  │  ├─ cover-art.ts                      # CREATE — Cover Art Archive fetcher
│  │  └─ metadata-worker.ts                # CREATE — drains MetadataJob queue
│  └─ actions/
│     └─ library.ts                        # MODIFY — add backfillMetadata action
├─ server/services/library-scanner.ts      # MODIFY — enqueue MetadataJob on ingest
├─ instrumentation.ts                      # MODIFY — also start metadata worker
├─ components/ipod/
│  ├─ screens/NowPlaying.tsx               # MODIFY — render cover art
│  ├─ screens/AlbumDetail.tsx              # MODIFY — render cover art
│  └─ screens/ArtistDetail.tsx             # MODIFY — render bio + photo
├─ server/actions/views.ts                 # MODIFY — include coverArtHash + bio in payloads

tests/server/
├─ musicbrainz.test.ts                     # mock fetch, verify parsing + rate limit
└─ cover-art.test.ts                       # mock fetch, verify caching
```

---

## Task 1: MusicBrainz service (TDD)

**Files:**
- Create: `src/server/services/musicbrainz.ts`
- Create: `tests/server/musicbrainz.test.ts`

API:
- `searchRecording(artist: string, title: string)` → array of `{ mbid, score, title, artistName, artistMbid?, releaseMbid?, releaseTitle? }` (top 5, ordered by score desc)
- `getArtist(mbid)` → `{ name, bio? }` (bio is optional)
- `getReleaseCoverArtMbid(recordingMbid)` → best release MBID for cover art lookup
- All hit MB endpoints with 1 req/sec rate limit + proper User-Agent

### Step 1: Failing test

Create `tests/server/musicbrainz.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("musicbrainz service", () => {
  it("searchRecording parses /ws/2/recording response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        recordings: [
          {
            id: "abc-123",
            score: 100,
            title: "From The Start",
            "artist-credit": [{ artist: { id: "artist-mb-1", name: "Laufey" } }],
            releases: [{ id: "release-mb-1", title: "Bewitched" }],
          },
          {
            id: "def-456",
            score: 72,
            title: "From The Start (Live)",
            "artist-credit": [{ artist: { id: "artist-mb-1", name: "Laufey" } }],
            releases: [{ id: "release-mb-2", title: "Live at Royal Albert Hall" }],
          },
        ],
      }),
    } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    const results = await searchRecording("Laufey", "From The Start");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      mbid: "abc-123",
      score: 100,
      title: "From The Start",
      artistName: "Laufey",
      artistMbid: "artist-mb-1",
      releaseMbid: "release-mb-1",
      releaseTitle: "Bewitched",
    });
  });

  it("getArtist returns name + optional bio", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "artist-mb-1",
        name: "Laufey",
        annotation: "Icelandic-Chinese jazz singer-songwriter",
      }),
    } as never);

    const { getArtist } = await import("@/server/services/musicbrainz");
    const a = await getArtist("artist-mb-1");
    expect(a.name).toBe("Laufey");
    expect(a.bio).toMatch(/Icelandic/);
  });

  it("sends User-Agent header per MB etiquette", async () => {
    process.env.MUSICBRAINZ_USER_AGENT = "MusicUniverse/1.0 ( test@example.com )";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ recordings: [] }),
    } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    await searchRecording("x", "y");
    const call = vi.mocked(fetch).mock.calls[0]!;
    const headers = (call[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["User-Agent"]).toMatch(/MusicUniverse/);
  });

  it("retries on 503 with backoff (returns successfully when retry succeeds)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503 } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ recordings: [] }),
      } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    const results = await searchRecording("x", "y");
    expect(results).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
  }, 10_000);
});
```

### Step 2: Implement

Create `src/server/services/musicbrainz.ts`:
```ts
import PQueue from "p-queue";
import { env } from "@/lib/env";

const BASE = "https://musicbrainz.org/ws/2";

// 1 req/sec per MB etiquette. interval=1100 for a tiny safety margin.
const queue = new PQueue({ concurrency: 1, interval: 1100, intervalCap: 1 });

export interface RecordingResult {
  mbid: string;
  score: number;
  title: string;
  artistName: string;
  artistMbid?: string;
  releaseMbid?: string;
  releaseTitle?: string;
}

export interface ArtistInfo {
  name: string;
  bio?: string;
}

interface MBRecording {
  id: string;
  score?: number;
  title: string;
  "artist-credit"?: { artist: { id: string; name: string } }[];
  releases?: { id: string; title: string }[];
}

async function mbFetch(path: string, search: Record<string, string>): Promise<Response> {
  const params = new URLSearchParams({ ...search, fmt: "json" });
  const url = `${BASE}${path}?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT },
    });
    if (res.ok) return res;
    if (res.status === 503 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`MusicBrainz ${res.status}: ${url}`);
  }
  throw new Error(`MusicBrainz exhausted retries: ${url}`);
}

export async function searchRecording(artist: string, title: string): Promise<RecordingResult[]> {
  return queue.add(async () => {
    const q = `artist:"${artist}" AND recording:"${title}"`;
    const res = await mbFetch("/recording", { query: q, limit: "5" });
    const data = (await res.json()) as { recordings?: MBRecording[] };
    return (data.recordings ?? []).map((r) => {
      const credit = r["artist-credit"]?.[0]?.artist;
      const release = r.releases?.[0];
      return {
        mbid: r.id,
        score: r.score ?? 0,
        title: r.title,
        artistName: credit?.name ?? "Unknown",
        artistMbid: credit?.id,
        releaseMbid: release?.id,
        releaseTitle: release?.title,
      };
    });
  }) as Promise<RecordingResult[]>;
}

export async function getArtist(mbid: string): Promise<ArtistInfo> {
  return queue.add(async () => {
    const res = await mbFetch(`/artist/${mbid}`, {});
    const data = (await res.json()) as { id: string; name: string; annotation?: string };
    return { name: data.name, bio: data.annotation };
  }) as Promise<ArtistInfo>;
}
```

### Step 3: Run, see pass → commit

```bash
pnpm test tests/server/musicbrainz.test.ts
git add -A && git commit -m "feat(mb): MusicBrainz recording + artist search service with rate limit"
```

---

## Task 2: Cover Art Archive service (TDD)

**Files:**
- Create: `src/server/services/cover-art.ts`
- Create: `tests/server/cover-art.test.ts`

`fetchCoverArt(releaseMbid)` → tries `https://coverartarchive.org/release/{mbid}/front-500`, writes bytes to `MUSIC_LIBRARY_PATH/.cache/art/<sha256>.jpg`, returns `{ path, hash }`. Returns null on 404.

### Step 1: Failing test, implement, commit

(See plan template — mock fetch + fs)

Implementation sketch:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "@/lib/env";

const ART_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "art");

export interface CoverArtResult {
  path: string;
  hash: string;
  mimeType: string;
}

export async function fetchCoverArt(releaseMbid: string): Promise<CoverArtResult | null> {
  const res = await fetch(`https://coverartarchive.org/release/${releaseMbid}/front-500`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CAA ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  await fs.mkdir(ART_DIR, { recursive: true });
  const filePath = path.join(ART_DIR, `${hash}.jpg`);
  await fs.writeFile(filePath, buf);
  return { path: filePath, hash, mimeType: "image/jpeg" };
}
```

---

## Task 3: Metadata enrichment worker

**Files:**
- Create: `src/server/services/metadata-worker.ts`

Worker drains `MetadataJob` queue rows in order, processes each:
1. `findUnique` Track + Artist
2. Call `searchRecording(artistName, trackTitle)`
3. If top result has score ≥85: update Track.mbid + metadataFetched. If artistMbid present: update Artist.mbid, optionally fetch artist bio. If releaseMbid present: update Album.mbid + enqueue cover art fetch.
4. If ambiguous (multiple ≥70): mark FAILED with `multi-match`.
5. If error: mark FAILED with the error message.

Implementation:
```ts
import { db } from "@/server/db";
import { searchRecording, getArtist } from "@/server/services/musicbrainz";
import { fetchCoverArt } from "@/server/services/cover-art";

let running = false;
let stop = false;

export function startMetadataWorker(): void {
  if (running) return;
  running = true;
  void loop();
}

export function stopMetadataWorker(): void {
  stop = true;
}

async function loop(): Promise<void> {
  while (!stop) {
    const job = await db.metadataJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    await db.metadataJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });
    try {
      if (job.trackId) await processTrackJob(job.trackId);
      await db.metadataJob.update({
        where: { id: job.id },
        data: { status: "DONE", completedAt: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.metadataJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: msg.slice(0, 500) },
      });
    }
  }
  running = false;
}

async function processTrackJob(trackId: string): Promise<void> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: { primaryArtist: true, album: true },
  });
  if (!track) return;

  const candidates = await searchRecording(track.primaryArtist.name, track.title);
  if (candidates.length === 0) {
    await db.track.update({ where: { id: trackId }, data: { metadataFetched: new Date() } });
    return;
  }
  const top = candidates[0]!;
  const strong = candidates.filter((c) => c.score >= 70);
  if (top.score < 85 || strong.length > 1) {
    throw new Error(`multi-match: top=${top.score}, ${strong.length} candidates ≥70`);
  }

  // Update Track
  await db.track.update({
    where: { id: trackId },
    data: {
      mbid: top.mbid,
      title: top.title,
      metadataFetched: new Date(),
    },
  });

  // Update Artist (fetch bio if not already set)
  if (top.artistMbid && top.artistName) {
    const existingArtist = await db.artist.findUnique({ where: { id: track.primaryArtistId } });
    if (existingArtist && !existingArtist.mbid) {
      try {
        const info = await getArtist(top.artistMbid);
        await db.artist.update({
          where: { id: track.primaryArtistId },
          data: { mbid: top.artistMbid, name: info.name, bio: info.bio ?? null, metadataFetched: new Date() },
        });
      } catch {
        // ignore artist enrich failure
      }
    }
  }

  // Update Album + fetch cover art
  if (top.releaseMbid && track.albumId) {
    const album = await db.album.findUnique({ where: { id: track.albumId } });
    if (album && !album.coverArtHash) {
      await db.album.update({
        where: { id: track.albumId },
        data: { mbid: top.releaseMbid, title: top.releaseTitle ?? album.title },
      });
      try {
        const art = await fetchCoverArt(top.releaseMbid);
        if (art) {
          await db.album.update({
            where: { id: track.albumId },
            data: { coverArtPath: art.path, coverArtHash: art.hash, metadataFetched: new Date() },
          });
        }
      } catch {
        // cover art is best-effort
      }
    }
  }
}
```

---

## Task 4: Hook ingest + add backfill action

**Files:**
- Modify: `src/server/services/library-scanner.ts` — `ingestFile()` enqueues a `MetadataJob` after creating Track
- Modify: `src/server/actions/library.ts` — add `backfillMetadata()` that enqueues jobs for every Track lacking `metadataFetched`
- Modify: `src/server/actions/search.ts` — `selectYtResult()` also enqueues a MetadataJob after creating the Track

In each, after creating the Track:
```ts
await db.metadataJob.create({
  data: { entityType: "TRACK", trackId: track.id, status: "QUEUED" },
});
```

`backfillMetadata` is exposed in Settings (Task 6).

---

## Task 5: `/api/art/[hash]` route

**Files:**
- Create: `src/app/api/art/[hash]/route.ts`

Serves cover art from `.cache/art/<hash>.jpg` with appropriate `Content-Type` and a long cache header (content-addressed, immutable):

```ts
import { NextResponse } from "next/server";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

const ART_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "art");
const HASH_RE = /^[a-f0-9]{64}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!HASH_RE.test(hash)) return NextResponse.json({ error: "bad_hash" }, { status: 400 });
  const filePath = path.join(ART_DIR, `${hash}.jpg`);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const data = await readFile(filePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

---

## Task 6: Start the worker on app boot + Settings backfill button

**Files:**
- Modify: `src/instrumentation.ts` — also call `startMetadataWorker()`
- Modify: `src/components/ipod/screens/Settings.tsx` — add "Backfill Metadata" row that calls `backfillMetadata()`

Settings becomes:
- Rescan Library
- Backfill Metadata
- Logout

(3 items.)

---

## Task 7: Render cover art in screens

**Files:**
- Modify: `src/server/actions/views.ts` — include `album.coverArtHash` in payloads (already mostly there)
- Modify: `src/stores/player-store.ts` — `QueueTrack` already has `coverArtPath?: string | null`; rename/repurpose to `coverArtHash?: string | null` (or add alongside)
- Modify: `src/components/ipod/screens/NowPlaying.tsx` — if `coverArtHash` present, render `<img src="/api/art/{hash}" />` instead of the gradient
- Modify: `src/components/ipod/screens/AlbumDetail.tsx` — same
- Update where `setQueue` is called to pass through `coverArtHash`

---

## Task 8: Show artist bio in ArtistDetail

**Files:**
- Modify: `src/server/actions/views.ts` — `getArtists` returns `bio` too; add a new `getArtistById(id)` if not present
- Modify: `src/components/ipod/screens/ArtistDetail.tsx` — render bio (truncated to ~3 lines) above the track list

---

## Task 9: End-to-end verify + merge

1. `pnpm test` 64+/64+
2. Restart dev server. Watch log: `[mu] metadata worker started`.
3. Settings → "Backfill Metadata" → enqueue jobs for all existing tracks.
4. Wait ~30 seconds. Check DB: tracks should now have `mbid` set, albums should have `coverArtHash` set.
5. Reload iPod. NowPlaying for "From The Start" should show real album cover.
6. ArtistDetail for Laufey should show MB bio.
7. tsc + lint + build clean.
8. Merge.

---

## Out of scope (Phase 5+)

- Manual correction UI for ambiguous matches (just stored as FAILED; can browse via `psql` for now)
- Related artists rendering
- Genre tags
- Stats / Wrapped — Phase 5
- Cover Flow album browser — Phase 6
