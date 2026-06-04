# Music Universe — Phase 2: Search + YouTube Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Type a song name on the iPod, get fuzzy matches from your local library + YouTube results, pick one, hear it play instantly (streaming from YT) while the m4a downloads in the background and becomes a regular library track.

**Architecture:**
1. **Local search** — Postgres `pg_trgm` `similarity()` ranks `Track.title`, `Artist.name`, `Album.title` against the query. Server action returns a blended list.
2. **YT search** — Server action shells out to `yt-dlp --search1: -j` (or `--default-search ytsearch5: -j`) to get the top 5 results' metadata as JSON. Returns title/uploader/duration/videoId/thumbnail.
3. **Stream-then-cache** — User picks a YT result → server creates a `Track` stub with `source=YT_STREAMING` and a `YtCacheEntry(PENDING)` → returns trackId. Audio engine plays `/api/audio/[trackId]` which the route handler now resolves: if `source=YT_STREAMING`, run `yt-dlp -g` to get the current direct YT m4a URL and proxy bytes. Meanwhile, an in-process `p-queue` worker spawns `yt-dlp -x --audio-format m4a` to download the file; on completion, write `filePath` + `sha256`, flip `source=YT_CACHED`, mark `YtCacheEntry.status=READY`. Next play of the same trackId serves from disk.
4. **Search UI** — Add `search` screen state. Renders a typeable input on the iPod screen (keyboard input, not click-wheel-spell — Phase 1 limitation list says click-wheel-spell is Phase 3+). Debounced query → server action → render two sections (Local results, YouTube results) → wheel scroll between rows → select to play.

**Tech Stack additions:** `p-queue` (in-process job queue for YT downloads). All other pieces use existing deps.

**Reference:** Spec §5 (YT flow), §6 (server actions), §7 Phase 2.

---

## Prerequisites

- Phase 1 merged to `main` (commit `554159a`) + test hotfix (`2967cda`).
- yt-dlp ≥ 2026.3.x installed (already done: 2026.3.17_2 via brew).
- ffmpeg installed.
- Postgres up. Existing library tracks ≥ 1 (the Tate McRae demo track from Phase 1 verification).
- Branch: create `phase-2-search-yt` off `main`.

```bash
git checkout main
git checkout -b phase-2-search-yt
```

---

## File Structure (Phase 2 additions)

```
src/
├─ app/api/audio/[trackId]/route.ts       # MODIFY — proxy YT m4a when source=YT_STREAMING
├─ components/ipod/
│  ├─ Ipod.tsx                            # MODIFY — handle "search" screen + selection on results
│  ├─ Screen.tsx                          # MODIFY — add Search + YtPicker screens
│  └─ screens/
│     ├─ Search.tsx                       # CREATE — typeable search input
│     └─ YtPicker.tsx                     # CREATE — YT results list
├─ server/
│  ├─ actions/
│  │  ├─ search.ts                        # CREATE — searchLibrary + searchYt + selectYtResult
│  │  └─ playback.ts                      # MODIFY — startPlay handles YT_STREAMING source
│  └─ services/
│     ├─ search.ts                        # CREATE — pg_trgm helpers
│     ├─ yt-service.ts                    # CREATE — wraps yt-dlp invocations
│     └─ yt-download-queue.ts             # CREATE — p-queue singleton for background downloads
└─ stores/
   └─ ipod-store.ts                       # MODIFY — add "search" + "ytPicker" screen states

tests/
├─ server/
│  ├─ search.test.ts                      # pg_trgm ranking
│  └─ yt-service.test.ts                  # parse yt-dlp JSON output (mock spawn)
└─ ...
```

---

## Conventions

- Same as Phase 1 — TDD strictly for services; smoke-test only for new screens.
- yt-dlp invocations use Node's `child_process.spawn` with explicit `env.YT_DLP_PATH`.
- Downloaded YT files land in `MUSIC_LIBRARY_PATH/.cache/yt/<ytVideoId>.m4a`.
- One task → one commit.

---

## Task 1: Install p-queue

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] Step 1: `pnpm add p-queue`
- [ ] Step 2: `pnpm test` — 34/34 still pass.
- [ ] Step 3: `git commit -m "chore: add p-queue for in-process background download queue"`

---

## Task 2: Local fuzzy search service (TDD)

**Files:**
- Create: `src/server/services/search.ts`
- Create: `tests/server/search.test.ts`

A pure-ish function: `searchLibrary(query: string)` → `{ tracks: [], artists: [], albums: [] }`, each ranked by `pg_trgm` similarity, top 10 per category, only items with similarity ≥ 0.1 (ignore noise).

- [ ] Step 1: Failing test (DB-dependent, gated by DATABASE_URL):

Create `tests/server/search.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("search service", () => {
  let createdTrackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "SearchTest Artist" },
      create: { name: "SearchTest Artist" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "SearchTest Album" } },
      create: { title: "SearchTest Album", artistId: artist.id },
      update: {},
    });
    const t1 = await db.track.create({
      data: {
        title: "From The Start",
        duration: 200,
        filePath: `/tmp/searchtest-${Date.now()}-1.m4a`,
        sha256: `searchtest-sha-${Date.now()}-1`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    const t2 = await db.track.create({
      data: {
        title: "Unrelated Song",
        duration: 180,
        filePath: `/tmp/searchtest-${Date.now()}-2.m4a`,
        sha256: `searchtest-sha-${Date.now()}-2`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    createdTrackIds = [t1.id, t2.id];
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    await db.album.deleteMany({ where: { title: "SearchTest Album" } });
    await db.artist.deleteMany({ where: { name: "SearchTest Artist" } });
  });

  it("ranks fuzzy track matches above non-matches", async () => {
    const { searchLibrary } = await import("@/server/services/search");
    const result = await searchLibrary("from the strt"); // typo
    const titles = result.tracks.map((t) => t.title);
    expect(titles).toContain("From The Start");
    expect(titles.indexOf("From The Start")).toBeLessThan(titles.indexOf("Unrelated Song"));
  });

  it("returns matched artists and albums too", async () => {
    const { searchLibrary } = await import("@/server/services/search");
    const result = await searchLibrary("SearchTest");
    expect(result.artists.some((a) => a.name === "SearchTest Artist")).toBe(true);
    expect(result.albums.some((a) => a.title === "SearchTest Album")).toBe(true);
  });
});
```

- [ ] Step 2: Run, see fail.

- [ ] Step 3: Implement.

Create `src/server/services/search.ts`:
```ts
import { db } from "@/server/db";

export interface SearchTrackResult {
  id: string;
  title: string;
  duration: number;
  artistId: string;
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  score: number;
}

export interface SearchArtistResult {
  id: string;
  name: string;
  score: number;
}

export interface SearchAlbumResult {
  id: string;
  title: string;
  artistName: string;
  score: number;
}

export interface SearchResults {
  tracks: SearchTrackResult[];
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
}

const MIN_SIMILARITY = 0.1;
const LIMIT_PER_CATEGORY = 10;

export async function searchLibrary(query: string): Promise<SearchResults> {
  const q = query.trim();
  if (q.length === 0) return { tracks: [], artists: [], albums: [] };

  const [tracks, artists, albums] = await Promise.all([
    db.$queryRaw<SearchTrackResult[]>`
      SELECT t.id, t.title, t.duration,
             ar.id AS "artistId", ar.name AS "artistName",
             al.id AS "albumId", al.title AS "albumTitle",
             similarity(t.title, ${q}) AS score
      FROM "Track" t
      JOIN "Artist" ar ON t."primaryArtistId" = ar.id
      LEFT JOIN "Album" al ON t."albumId" = al.id
      WHERE t.playable = true AND t.title % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
    db.$queryRaw<SearchArtistResult[]>`
      SELECT id, name, similarity(name, ${q}) AS score
      FROM "Artist"
      WHERE name % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
    db.$queryRaw<SearchAlbumResult[]>`
      SELECT al.id, al.title, ar.name AS "artistName",
             similarity(al.title, ${q}) AS score
      FROM "Album" al
      JOIN "Artist" ar ON al."artistId" = ar.id
      WHERE al.title % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
  ]);

  return {
    tracks: tracks.filter((r) => r.score >= MIN_SIMILARITY),
    artists: artists.filter((r) => r.score >= MIN_SIMILARITY),
    albums: albums.filter((r) => r.score >= MIN_SIMILARITY),
  };
}
```

The `%` operator is the `pg_trgm` similarity operator — falls back to GIN index. Default threshold is 0.3 but we filter on the result with `>= 0.1` for more leniency.

- [ ] Step 4: Run, see pass.

- [ ] Step 5: Commit: `feat: add pg_trgm fuzzy search across tracks/artists/albums`.

---

## Task 3: YT service (TDD with mocked spawn)

**Files:**
- Create: `src/server/services/yt-service.ts`
- Create: `tests/server/yt-service.test.ts`

Exposes `searchYt(query, limit)`, `resolveDirectUrl(videoId)`, `downloadAudio(videoId, destDir)`.

Each shells out to `yt-dlp` via `child_process.spawn`. Tests mock the spawn return.

- [ ] Step 1: Failing test.

Create `tests/server/yt-service.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("yt-service", () => {
  it("searchYt parses yt-dlp JSON-lines output", async () => {
    const cp = await import("node:child_process");
    const fakeProc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const promise = searchYt("from the start", 2);

    fakeProc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ id: "vid1", title: "From The Start", uploader: "Laufey", duration: 196, thumbnail: "http://x/y.jpg" }) +
          "\n" +
          JSON.stringify({ id: "vid2", title: "From The Start (Live)", uploader: "Laufey", duration: 200 }) +
          "\n",
      ),
    );
    fakeProc.emit("close", 0);

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results[0]?.videoId).toBe("vid1");
    expect(results[0]?.title).toBe("From The Start");
    expect(results[0]?.uploader).toBe("Laufey");
    expect(results[0]?.duration).toBe(196);
  });

  it("searchYt rejects on non-zero exit", async () => {
    const cp = await import("node:child_process");
    const fakeProc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const promise = searchYt("x", 1);
    fakeProc.stderr.emit("data", Buffer.from("ERROR: boom\n"));
    fakeProc.emit("close", 1);
    await expect(promise).rejects.toThrow(/yt-dlp/);
  });
});
```

- [ ] Step 2: Run, see fail.

- [ ] Step 3: Implement.

Create `src/server/services/yt-service.ts`:
```ts
import { spawn } from "node:child_process";
import { env } from "@/lib/env";

export interface YtSearchResult {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

interface YtJson {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(env.YT_DLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

export async function searchYt(query: string, limit = 5): Promise<YtSearchResult[]> {
  const args = [
    `ytsearch${limit}:${query}`,
    "--no-warnings",
    "-J",
    "--flat-playlist",
  ];
  // -J emits a single JSON object with an "entries" array
  const raw = await runYtDlp(args);
  // yt-dlp's -J may emit either {entries: [...]} or, with flat-playlist + ytsearchN,
  // a top-level object — handle both.
  const parsed = JSON.parse(raw) as YtJson & { entries?: YtJson[] };
  const entries: YtJson[] = parsed.entries ?? [parsed];
  return entries
    .filter((e) => e.id)
    .slice(0, limit)
    .map((e) => ({
      videoId: e.id!,
      title: e.title ?? "Unknown",
      uploader: e.uploader ?? e.channel ?? "Unknown",
      duration: Math.round(e.duration ?? 0),
      thumbnail: e.thumbnail ?? null,
    }));
}

export async function resolveDirectUrl(videoId: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const raw = await runYtDlp(["-f", "bestaudio[ext=m4a]/bestaudio", "-g", "--no-warnings", url]);
  return raw.trim().split("\n")[0] ?? "";
}

export interface DownloadResult {
  filePath: string;
  fileFormat: string;
}

export async function downloadAudio(videoId: string, destDir: string): Promise<DownloadResult> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputTemplate = `${destDir}/${videoId}.%(ext)s`;
  await runYtDlp([
    url,
    "-x",
    "--audio-format",
    "m4a",
    "-o",
    outputTemplate,
    "--no-warnings",
    "--embed-metadata",
  ]);
  return { filePath: `${destDir}/${videoId}.m4a`, fileFormat: "m4a" };
}
```

Important note: the failing test uses JSON-lines (one object per line), but the actual implementation uses `-J` (single JSON object). The test will need to be rewritten to match `-J` output. Update the test:

Replace test 1 with:
```ts
it("searchYt parses yt-dlp -J output", async () => {
  const cp = await import("node:child_process");
  const fakeProc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  fakeProc.stdout = new EventEmitter();
  fakeProc.stderr = new EventEmitter();
  vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

  const { searchYt } = await import("@/server/services/yt-service");
  const promise = searchYt("from the start", 2);

  fakeProc.stdout.emit(
    "data",
    Buffer.from(
      JSON.stringify({
        entries: [
          { id: "vid1", title: "From The Start", uploader: "Laufey", duration: 196, thumbnail: "http://x/y.jpg" },
          { id: "vid2", title: "From The Start (Live)", uploader: "Laufey", duration: 200 },
        ],
      }),
    ),
  );
  fakeProc.emit("close", 0);

  const results = await promise;
  expect(results).toHaveLength(2);
  expect(results[0]?.videoId).toBe("vid1");
});
```

- [ ] Step 4: Run, see pass.

- [ ] Step 5: Commit: `feat: add yt-dlp wrapper service (search, resolve, download)`.

---

## Task 4: Background download queue

**Files:**
- Create: `src/server/services/yt-download-queue.ts`

Singleton p-queue with concurrency=1. Exposes `enqueueDownload(videoId)`. The worker:
1. Marks `YtCacheEntry.status = DOWNLOADING`
2. Runs `downloadAudio(videoId, MUSIC_LIBRARY_PATH/.cache/yt)`
3. Computes sha256 of the file
4. Updates `Track.filePath`, `sha256`, `source=YT_CACHED`
5. Marks `YtCacheEntry.status = READY`, `completedAt = now`
6. On error: `status = FAILED`, `errorMessage = ...`, increment `attempts`

- [ ] Step 1: Implement.

Create `src/server/services/yt-download-queue.ts`:
```ts
import PQueue from "p-queue";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { downloadAudio } from "@/server/services/yt-service";

const queue = new PQueue({ concurrency: 1 });

const CACHE_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "yt");

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

async function processDownload(videoId: string): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await db.ytCacheEntry.update({
    where: { ytVideoId: videoId },
    data: { status: "DOWNLOADING", attempts: { increment: 1 } },
  });
  try {
    const { filePath, fileFormat } = await downloadAudio(videoId, CACHE_DIR);
    const sha = await sha256(filePath);
    const stats = await fs.stat(filePath);
    const entry = await db.ytCacheEntry.findUnique({
      where: { ytVideoId: videoId },
      select: { trackId: true },
    });
    if (entry?.trackId) {
      await db.track.update({
        where: { id: entry.trackId },
        data: {
          filePath,
          fileFormat,
          fileSize: BigInt(stats.size),
          sha256: sha,
          source: "YT_CACHED",
        },
      });
    }
    await db.ytCacheEntry.update({
      where: { ytVideoId: videoId },
      data: { status: "READY", completedAt: new Date(), localFilePath: filePath },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ytCacheEntry.update({
      where: { ytVideoId: videoId },
      data: { status: "FAILED", errorMessage: message.slice(0, 500) },
    });
    throw err;
  }
}

export function enqueueDownload(videoId: string): void {
  void queue.add(() => processDownload(videoId).catch(() => {}));
}

export function queueSize(): number {
  return queue.size + queue.pending;
}
```

- [ ] Step 2: Verify build (`pnpm exec tsc --noEmit`).

- [ ] Step 3: Commit: `feat: add background download queue for YT m4a cache`.

---

## Task 5: Server actions (search + selectYtResult)

**Files:**
- Create: `src/server/actions/search.ts`

- [ ] Step 1: Implement.

Create `src/server/actions/search.ts`:
```ts
"use server";

import { db } from "@/server/db";
import { searchLibrary as serviceSearch } from "@/server/services/search";
import { searchYt as ytServiceSearch, type YtSearchResult } from "@/server/services/yt-service";
import { enqueueDownload } from "@/server/services/yt-download-queue";

export async function searchLibrary(query: string) {
  return serviceSearch(query);
}

export async function searchYt(query: string): Promise<YtSearchResult[]> {
  return ytServiceSearch(query, 5);
}

export async function selectYtResult(
  result: YtSearchResult,
): Promise<{ trackId: string }> {
  // Reuse existing Track if the same videoId was already streamed/cached
  const existing = await db.track.findUnique({
    where: { ytVideoId: result.videoId },
    select: { id: true },
  });
  if (existing) return { trackId: existing.id };

  // Create "Unknown" artist + album as containers — Phase 4 enrichment fixes these
  const artist = await db.artist.upsert({
    where: { name: result.uploader },
    create: { name: result.uploader, discoveredAt: new Date() },
    update: {},
  });
  const album = await db.album.upsert({
    where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
    create: { title: "YouTube", artistId: artist.id },
    update: {},
  });
  const track = await db.track.create({
    data: {
      title: result.title,
      duration: result.duration,
      primaryArtistId: artist.id,
      albumId: album.id,
      ytVideoId: result.videoId,
      source: "YT_STREAMING",
      playable: true,
      discoveredAt: new Date(),
    },
    select: { id: true },
  });
  await db.ytCacheEntry.create({
    data: { ytVideoId: result.videoId, trackId: track.id, status: "PENDING" },
  });
  enqueueDownload(result.videoId);
  return { trackId: track.id };
}
```

- [ ] Step 2: Commit: `feat: add search + selectYtResult server actions`.

---

## Task 6: Extend `/api/audio/[trackId]` to proxy YT streams

**Files:**
- Modify: `src/app/api/audio/[trackId]/route.ts`

The route currently returns 501 if `filePath` is null. Instead: if `source=YT_STREAMING` and `ytVideoId` is set, resolve direct URL via `yt-service.resolveDirectUrl`, then proxy bytes from there (with Range support).

- [ ] Step 1: Implement.

Add to route handler (replace the early 501 return):

```ts
if (!track.filePath) {
  if (track.source === "YT_STREAMING" && track.ytVideoId) {
    return await streamFromYt(track.ytVideoId, req);
  }
  return NextResponse.json({ error: "not_yet_supported", reason: track.source }, { status: 501 });
}
```

Add helper at the top of the file:
```ts
import { resolveDirectUrl } from "@/server/services/yt-service";

async function streamFromYt(videoId: string, req: Request): Promise<Response> {
  const directUrl = await resolveDirectUrl(videoId);
  if (!directUrl) return NextResponse.json({ error: "yt_resolve_failed" }, { status: 502 });
  // Forward the Range header (if any) so YT serves the right bytes
  const range = req.headers.get("range");
  const ytRes = await fetch(directUrl, {
    headers: range ? { Range: range } : undefined,
  });
  if (!ytRes.ok && ytRes.status !== 206) {
    return NextResponse.json({ error: "yt_fetch_failed", status: ytRes.status }, { status: 502 });
  }
  const headers = new Headers();
  headers.set("Content-Type", ytRes.headers.get("content-type") ?? "audio/mp4");
  const cl = ytRes.headers.get("content-length");
  if (cl) headers.set("Content-Length", cl);
  const cr = ytRes.headers.get("content-range");
  if (cr) headers.set("Content-Range", cr);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store"); // YT URLs expire ~6h, don't cache client-side
  return new Response(ytRes.body, { status: ytRes.status, headers });
}
```

- [ ] Step 2: Verify build.

- [ ] Step 3: Commit: `feat: unified audio route now proxies YT streams when filePath is null`.

---

## Task 7: Search + YtPicker screens

**Files:**
- Modify: `src/stores/ipod-store.ts` — add `search` and `ytPicker` screen states
- Create: `src/components/ipod/screens/Search.tsx`
- Create: `src/components/ipod/screens/YtPicker.tsx`
- Modify: `src/components/ipod/Screen.tsx` — handle both new screens

- [ ] Step 1: Add screen states to `ipod-store.ts`:

```ts
export type ScreenState =
  | { name: "home" }
  | { name: "musicSub" }
  | { name: "artistList" }
  | { name: "artistDetail"; artistId: string }
  | { name: "albumList" }
  | { name: "albumDetail"; albumId: string }
  | { name: "songList" }
  | { name: "nowPlaying" }
  | { name: "search" }
  | { name: "ytPicker"; query: string }; // carries the query so YtPicker can fetch
```

- [ ] Step 2: Implement Search screen.

Create `src/components/ipod/screens/Search.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import {
  searchLibrary,
  type SearchResults,
} from "@/server/actions/search";
import { formatDuration } from "@/lib/format-duration";

interface SearchProps {
  selected?: number;
}

export function Search({ selected = 0 }: SearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ tracks: [], artists: [], albums: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced local search
  useEffect(() => {
    if (query.trim().length === 0) {
      setResults({ tracks: [], artists: [], albums: [] });
      return;
    }
    const handle = setTimeout(() => {
      void searchLibrary(query).then(setResults);
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const totalLocal = results.tracks.length + results.artists.length + results.albums.length;
  const showYtOption = query.trim().length > 0;

  function flatRow(i: number): { label: string; action: () => void; trailing?: string } | null {
    let idx = i;
    if (idx < results.tracks.length) {
      const t = results.tracks[idx]!;
      return {
        label: `♪ ${t.title}`,
        trailing: t.artistName,
        action: () => {
          usePlayerStore.getState().setQueue(
            [{ id: t.id, title: t.title, duration: t.duration, artist: t.artistName, album: t.albumTitle ?? "" }],
            0,
          );
          push({ name: "nowPlaying" });
        },
      };
    }
    idx -= results.tracks.length;
    if (idx < results.artists.length) {
      const a = results.artists[idx]!;
      return { label: `👤 ${a.name}`, action: () => push({ name: "artistList" }) };
    }
    idx -= results.artists.length;
    if (idx < results.albums.length) {
      const al = results.albums[idx]!;
      return { label: `💿 ${al.title}`, trailing: al.artistName, action: () => push({ name: "albumList" }) };
    }
    idx -= results.albums.length;
    if (showYtOption && idx === 0) {
      return { label: `▶ Search YouTube for "${query}"`, action: () => push({ name: "ytPicker", query }) };
    }
    return null;
  }

  const rowCount = totalLocal + (showYtOption ? 1 : 0);
  const safeSel = Math.min(Math.max(0, selected), Math.max(0, rowCount - 1));

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Search
      </div>
      <div className="border-b border-black/10 px-2 py-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a song..."
          className="w-full rounded border border-black/20 bg-white/80 px-1 py-0.5 text-[11px] text-black outline-none"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {Array.from({ length: rowCount }, (_, i) => {
          const row = flatRow(i);
          if (!row) return null;
          return (
            <div
              key={i}
              className={
                "flex items-center justify-between border-b border-black/5 px-2 py-0.5 " +
                (i === safeSel
                  ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                  : "")
              }
            >
              <span className="truncate">{row.label}</span>
              {row.trailing && <span className="ml-2 text-[9px] opacity-70">{row.trailing}</span>}
            </div>
          );
        })}
        {query && totalLocal === 0 && !showYtOption && (
          <div className="grid h-20 place-items-center text-[10px] text-zinc-600">
            No matches.
          </div>
        )}
      </div>
    </div>
  );
}

export function searchSelectAction(query: string, selected: number, push: (s: { name: "ytPicker"; query: string } | { name: "nowPlaying" }) => void, setPlayQueue: (id: string, title: string, duration: number, artist: string, album: string) => void, results: SearchResults): void {
  // helper for Ipod.tsx to translate select → action; implemented inline in Ipod.tsx
}
```

Notes:
- `Search.tsx` does its OWN debounced fetch (not driven by Ipod). The `selected` prop is just for highlight.
- The "select" action mapping is encoded inside the screen via the `flatRow` helper. But the iPod's main `handleSelect` needs to invoke that action. **Cleaner approach: expose the action via a ref or context.** Phase 2 simplification: the iPod just navigates to ytPicker if the selected row is "the YT option" — for that, the iPod needs to know the row count and which row is the YT option. We achieve this by reading `data-` attributes from the rendered DOM. See Task 8 for the Ipod wiring details.

- [ ] Step 3: Implement YtPicker.

Create `src/components/ipod/screens/YtPicker.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { searchYt, selectYtResult } from "@/server/actions/search";
import type { YtSearchResult } from "@/server/services/yt-service";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface YtPickerProps {
  query: string;
  selected?: number;
}

export function YtPicker({ query, selected = 0 }: YtPickerProps) {
  const [results, setResults] = useState<YtSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void searchYt(query)
      .then((r) => !cancelled && setResults(r))
      .catch((e) => !cancelled && setError(e?.message ?? "search failed"));
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (error) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-red-700">
        YT error: {error}
      </div>
    );
  }

  if (results === null) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-zinc-600">
        Searching YouTube for &ldquo;{query}&rdquo;...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-zinc-600">
        No YouTube results.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        YT: {query}
      </div>
      <div className="flex-1 overflow-auto">
        {results.map((r, i) => (
          <div
            key={r.videoId}
            data-yt-video-id={r.videoId}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-0.5 " +
              (i === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{r.title}</div>
              <div className="truncate text-[9px] opacity-70">{r.uploader}</div>
            </div>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] Step 4: Update `Screen.tsx`:

```tsx
case "search":
  return <Search selected={selected} />;
case "ytPicker":
  return <YtPicker query={current.query} selected={selected} />;
```

Add imports.

- [ ] Step 5: Verify `pnpm exec tsc --noEmit`.

- [ ] Step 6: Commit: `feat: add Search + YtPicker screens with debounced fuzzy queries`.

---

## Task 8: Wire Search into Ipod (HomeMenu entry + select handling)

**Files:**
- Modify: `src/components/ipod/screens/HomeMenu.tsx` — add "Search" row
- Modify: `src/components/ipod/Ipod.tsx`

- [ ] Step 1: HomeMenu adds Search:

```tsx
const items = [
  { label: "Music" },
  { label: "Search" },
  { label: "Now Playing" },
];
```

- [ ] Step 2: Ipod.tsx — extend rowCount + handleSelect:

In the `useEffect` that computes rowCount, change `if (current.name === "home") setRowCount(2);` to `setRowCount(3);`.

In `handleSelect`:

```ts
if (current.name === "home") {
  if (sel === 0) push({ name: "musicSub" });
  else if (sel === 1) push({ name: "search" });
  else if (sel === 2) push({ name: "nowPlaying" });
}
```

For the search screen, selection action is tricky: the rows are mixed local results + a "Search YouTube" option. Ipod.tsx doesn't know what each row means. Approach: dispatch by reading `data-` attributes off the DOM.

Better: add a `currentScreenActions` ref pattern. But simplest: expose `currentRowAction` via a small Zustand "screen-bus" store.

For Phase 2 pragmatism: when search screen is active and the user presses select, dispatch a custom DOM event that the Search screen listens for. The screen then runs the appropriate action using its own (debounced) results state.

Implementation:

In `Search.tsx`, add an effect that listens for `ipod-select` events:
```tsx
useEffect(() => {
  function handler(e: Event) {
    const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
    const row = flatRow(idx);
    row?.action();
  }
  window.addEventListener("ipod-select", handler as EventListener);
  return () => window.removeEventListener("ipod-select", handler as EventListener);
}, [results, query]);
```

In `Ipod.tsx` `handleSelect`, when `current.name === "search"`:
```ts
window.dispatchEvent(new CustomEvent("ipod-select", { detail: { selected } }));
```

Same pattern for `YtPicker.tsx` — listen for `ipod-select`, look up `results[selected]`, call `selectYtResult` + push `nowPlaying`.

In `YtPicker.tsx`:
```tsx
useEffect(() => {
  if (!results) return;
  function handler(e: Event) {
    const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
    const result = results[idx];
    if (!result) return;
    void selectYtResult(result).then(({ trackId }) => {
      usePlayerStore.getState().setQueue(
        [{
          id: trackId,
          title: result.title,
          duration: result.duration,
          artist: result.uploader,
          album: "YouTube",
        }],
        0,
      );
      useIpodStore.getState().push({ name: "nowPlaying" });
    });
  }
  window.addEventListener("ipod-select", handler as EventListener);
  return () => window.removeEventListener("ipod-select", handler as EventListener);
}, [results]);
```

And update Ipod's rowCount calculation: for search and ytPicker, the row count must come from the screens themselves (since the data is dynamic). Use the same custom-event pattern in reverse — the screen dispatches `ipod-row-count` events when its results change, the iPod listens and updates `rowCount`.

In each screen (Search + YtPicker), after results update, dispatch:
```tsx
window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: rowCount } }));
```

In Ipod.tsx, add a useEffect:
```tsx
useEffect(() => {
  function handler(e: Event) {
    setRowCount((e as CustomEvent<{ count: number }>).detail.count);
  }
  window.addEventListener("ipod-row-count", handler as EventListener);
  return () => window.removeEventListener("ipod-row-count", handler as EventListener);
}, []);
```

And in the screen-change effect, for "search" / "ytPicker", set rowCount = 0 initially (the screen will publish the real count).

- [ ] Step 3: Verify `pnpm exec tsc --noEmit`, build clean.

- [ ] Step 4: Commit: `feat: wire Search + YtPicker into iPod via custom event bus`.

---

## Task 9: End-to-end manual verification

- [ ] Step 1: Restart dev server.
- [ ] Step 2: Navigate Home → Search.
- [ ] Step 3: Type "tate mcrae" — should fuzzy-match the existing track (Phase 1's downloaded one).
- [ ] Step 4: Type "abc xyz wontmatch" — no local results, "Search YouTube" row appears.
- [ ] Step 5: Select the YT row → YtPicker appears showing 5 YT results.
- [ ] Step 6: Pick one → it lands in NowPlaying and starts streaming from YT.
- [ ] Step 7: Wait ~30s → file should appear in `~/Music/MusicUniverse/.cache/yt/<videoId>.m4a`.
- [ ] Step 8: Reload, search again, pick same track → now serves from disk (no YT call).
- [ ] Step 9: tsc / test / lint / build all clean.
- [ ] Step 10: Commit any leftover changes.

---

## Out of scope (deferred)

- ArtistDetail / AlbumDetail navigation — Phase 4
- Click-wheel-spell-letters search (vs keyboard input) — Phase 3 polish
- YT URL refresh mid-stream (YT URLs expire ~6h) — Phase 3 polish
- Metadata enrichment for YT-sourced tracks (replace "uploader" with real artist name from MusicBrainz) — Phase 4
- Visual indication of "downloading…" badge on streaming tracks — Phase 3 polish
- YT cache disk-quota LRU eviction — Phase 6 polish
