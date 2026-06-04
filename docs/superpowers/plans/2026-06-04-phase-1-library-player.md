# Music Universe — Phase 1: Library + Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working iPod Nano 2G that scans your local music folder, organizes by artist/album/track, lets you browse via the click wheel (keyboard + mouse-wheel + pointer-drag-on-rim + touch-drag), and plays tracks end-to-end with shuffle, repeat, volume, seek, and OS lock-screen controls.

**Architecture:**
1. **Server side** — A chokidar-driven scanner reads ID3 tags from `MUSIC_LIBRARY_PATH`, upserts Artist→Album→Track rows, dedupes by SHA-256. A unified `/api/audio/[trackId]` route streams local files with HTTP Range support. Server actions handle library scan / playback recording / view payloads.
2. **Client side** — A single `<Ipod>` component (no client router; URL stays at `/`) renders a Nano 2G chassis around a fixed-size screen + a click wheel. The wheel emits six abstract events (`scroll(±1)`, `select`, `menu`, `prev`, `next`, `playPause`); a Zustand `navStack: ScreenState[]` FSM drives which screen renders. Virtualized lists handle the 5k-50k library scale. A singleton audio engine wraps one `<audio>` element + the MediaSession API.

**Tech Stack additions:** `chokidar` (file watcher), `music-metadata` (ID3 parsing), `zustand` (state), `@tanstack/react-virtual` (virtualized lists), `framer-motion` (gentle screen transitions — optional, can drop if too heavy).

**Reference:** Spec at `docs/superpowers/specs/2026-06-04-music-universe-design.md` (§3 data model, §4 iPod state machine, §6 API surface, §7 Phase 1).

---

## Prerequisites

- Phase 0 merged to `main` (commit `15fb780`).
- Postgres up via `docker compose up -d db` (port 5433).
- `.env` populated with real `APP_PASSWORD_HASH`, `COOKIE_SECRET`, and a valid `MUSIC_LIBRARY_PATH` pointing at a folder with at least a handful of m4a / mp3 files for verification.
- Branch: create `phase-1-library-player` off `main` before starting.

```bash
git checkout main
git checkout -b phase-1-library-player
```

---

## File Structure (Phase 1 additions)

```
src/
├─ app/
│  ├─ page.tsx                          # MODIFY — replace placeholder with <Ipod />
│  ├─ login/page.tsx                    # MODIFY — iPod-styled login
│  └─ api/
│     └─ audio/[trackId]/route.ts       # CREATE — Range-streaming local files
├─ audio/
│  ├─ engine.ts                         # CREATE — singleton <audio> wrapper
│  └─ media-session.ts                  # CREATE — OS lock-screen integration
├─ stores/
│  ├─ ipod-store.ts                     # CREATE — navStack + wheelGesture
│  └─ player-store.ts                   # CREATE — queue + playback state
├─ components/
│  └─ ipod/
│     ├─ Ipod.tsx                       # CREATE — assembles chassis + screen + wheel
│     ├─ Chassis.tsx                    # CREATE — Nano 2G visual chassis
│     ├─ Screen.tsx                     # CREATE — state-machine switch
│     ├─ ClickWheel.tsx                 # CREATE — 4 input layers
│     ├─ wheel-gestures.ts              # CREATE — pointer/keyboard/scroll helpers
│     └─ screens/
│        ├─ HomeMenu.tsx                # CREATE
│        ├─ MusicSub.tsx                # CREATE
│        ├─ VirtualizedList.tsx         # CREATE — shared primitive
│        ├─ ArtistList.tsx              # CREATE
│        ├─ AlbumList.tsx               # CREATE
│        ├─ SongList.tsx                # CREATE
│        └─ NowPlaying.tsx              # CREATE
├─ server/
│  ├─ actions/
│  │  ├─ library.ts                     # CREATE — rescanLibrary
│  │  ├─ playback.ts                    # CREATE — startPlay, updatePlayProgress
│  │  └─ views.ts                       # CREATE — getArtists, getAlbums, getSongs
│  └─ services/
│     ├─ id3-reader.ts                  # CREATE — ID3 parser wrapper
│     ├─ library-scanner.ts             # CREATE — chokidar-based ingestion
│     └─ audio-stream.ts                # CREATE — HTTP Range helper
└─ lib/
   └─ format-duration.ts                # CREATE — "3:45" formatter

tests/
├─ server/
│  ├─ id3-reader.test.ts
│  ├─ library-scanner.test.ts
│  └─ audio-stream.test.ts
├─ audio/
│  └─ engine.test.ts
├─ stores/
│  ├─ ipod-store.test.ts
│  └─ player-store.test.ts
└─ components/
   └─ ipod/
      ├─ ClickWheel.test.tsx            # jsdom env
      └─ Screen.test.tsx                # jsdom env
```

---

## Conventions

- **TDD strictly for**: services (id3-reader, library-scanner, audio-stream), audio engine, Zustand stores, ClickWheel event dispatch. **Smoke tests only for** screen components (just render-doesn't-crash).
- **Per-file vitest environment** — `tests/components/**/*.test.tsx` needs jsdom; add `// @vitest-environment jsdom` at the top of those files. Default stays `node`.
- **Server-side data fetching** uses Server Actions (not API routes) for everything that isn't a stream.
- **Audio engine is a module-level singleton** behind a `getEngine()` accessor. No React provider — multiple components subscribe via Zustand selectors.
- **Click wheel events** are 6 discrete: `scroll(-1)`, `scroll(+1)`, `select`, `menu`, `prev`, `next`, `playPause`. Hold-menu = pop to root (handled in the FSM, not the wheel).
- **Screen viewport** — 176×132 logical pixels (Nano 2G screen aspect), scaled up via CSS `transform: scale(N)` so it's actually legible (`N` is 2-3 depending on viewport). Children render in logical pixels; the chassis handles scaling.
- **Path alias** — `@/*` → `src/*`, same as Phase 0.
- **Each task → ONE commit.**

---

## Task 1: Install Phase 1 dependencies

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add chokidar music-metadata zustand @tanstack/react-virtual
```

- [ ] **Step 2: Verify versions**

```bash
pnpm list chokidar music-metadata zustand @tanstack/react-virtual --depth=0
```
Expected: 4 packages listed with version numbers. `music-metadata` should be v10+ (ESM); if you get v7, that's OK but the API may differ slightly.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add phase 1 deps (chokidar, music-metadata, zustand, react-virtual)"
```

---

## Task 2: ID3 reader service

**Files:**
- Create: `src/server/services/id3-reader.ts`
- Create: `tests/server/id3-reader.test.ts`

The reader takes a file path and returns `{ title, artistName, albumTitle, durationSec, trackNumber, discNumber, bitrate, fileFormat }`. It must gracefully degrade when tags are missing (fall back to filename for title; "Unknown Artist" / "Unknown Album" for missing tags).

- [ ] **Step 1: Write failing test**

Create `tests/server/id3-reader.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readTrackMetadata } from "@/server/services/id3-reader";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

describe("id3-reader", () => {
  it("falls back to filename + unknown for an unknown file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-id3-"));
    const file = path.join(dir, "Random Title.m4a");
    await fs.writeFile(file, Buffer.alloc(8)); // empty-ish file, no real ID3
    const meta = await readTrackMetadata(file);
    expect(meta.title).toBe("Random Title");
    expect(meta.artistName).toBe("Unknown Artist");
    expect(meta.albumTitle).toBe("Unknown Album");
    expect(meta.durationSec).toBeGreaterThanOrEqual(0);
    expect(meta.fileFormat).toBe("m4a");
    await fs.rm(dir, { recursive: true });
  });

  it("strips file extension from filename fallback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-id3-"));
    const file = path.join(dir, "Some Song.mp3");
    await fs.writeFile(file, Buffer.alloc(8));
    const meta = await readTrackMetadata(file);
    expect(meta.title).toBe("Some Song");
    expect(meta.fileFormat).toBe("mp3");
    await fs.rm(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
pnpm test tests/server/id3-reader.test.ts
```
Expected: failures (module not found).

- [ ] **Step 3: Implement**

Create `src/server/services/id3-reader.ts`:
```ts
import { parseFile } from "music-metadata";
import path from "node:path";

export interface TrackMetadata {
  title: string;
  artistName: string;
  albumTitle: string;
  durationSec: number;
  trackNumber: number | null;
  discNumber: number | null;
  bitrate: number | null;
  fileFormat: string;
}

export async function readTrackMetadata(filePath: string): Promise<TrackMetadata> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const filenameTitle = path.basename(filePath, path.extname(filePath));

  let tags: Awaited<ReturnType<typeof parseFile>>["common"] | null = null;
  let format: Awaited<ReturnType<typeof parseFile>>["format"] | null = null;
  try {
    const parsed = await parseFile(filePath, { duration: true });
    tags = parsed.common;
    format = parsed.format;
  } catch {
    // bad/empty file — fall through to filename-based defaults
  }

  return {
    title: tags?.title?.trim() || filenameTitle,
    artistName: tags?.artist?.trim() || tags?.albumartist?.trim() || "Unknown Artist",
    albumTitle: tags?.album?.trim() || "Unknown Album",
    durationSec: Math.round(format?.duration ?? 0),
    trackNumber: tags?.track?.no ?? null,
    discNumber: tags?.disk?.no ?? null,
    bitrate: format?.bitrate ?? null,
    fileFormat: ext,
  };
}
```

- [ ] **Step 4: Run, see pass**

```bash
pnpm test tests/server/id3-reader.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/id3-reader.ts tests/server/id3-reader.test.ts
git commit -m "feat: add id3 reader with filename fallback"
```

---

## Task 3: Audio stream service (HTTP Range helper)

**Files:**
- Create: `src/server/services/audio-stream.ts`
- Create: `tests/server/audio-stream.test.ts`

A pure function `parseRange(header, fileSize) → { start, end } | null | { error: 'invalid' }`. The route handler in Task 4 uses it to set HTTP 206 Partial Content responses correctly.

- [ ] **Step 1: Write failing test**

Create `tests/server/audio-stream.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseRange } from "@/server/services/audio-stream";

describe("parseRange", () => {
  const size = 1000;

  it("returns null when header is missing", () => {
    expect(parseRange(undefined, size)).toBeNull();
    expect(parseRange(null, size)).toBeNull();
  });

  it("parses 'bytes=0-99'", () => {
    expect(parseRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
  });

  it("parses 'bytes=500-' as start-to-end", () => {
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });

  it("parses 'bytes=-200' as last 200 bytes", () => {
    expect(parseRange("bytes=-200", size)).toEqual({ start: 800, end: 999 });
  });

  it("clamps end to file size minus one", () => {
    expect(parseRange("bytes=0-99999", size)).toEqual({ start: 0, end: 999 });
  });

  it("returns invalid when range is unsatisfiable", () => {
    expect(parseRange("bytes=2000-3000", size)).toEqual({ error: "invalid" });
  });

  it("returns invalid for garbage", () => {
    expect(parseRange("not-a-range", size)).toEqual({ error: "invalid" });
    expect(parseRange("bytes=", size)).toEqual({ error: "invalid" });
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
pnpm test tests/server/audio-stream.test.ts
```

- [ ] **Step 3: Implement**

Create `src/server/services/audio-stream.ts`:
```ts
export type Range = { start: number; end: number };
export type RangeResult = Range | { error: "invalid" } | null;

export function parseRange(header: string | undefined | null, fileSize: number): RangeResult {
  if (!header) return null;
  if (!header.startsWith("bytes=")) return { error: "invalid" };
  const spec = header.slice("bytes=".length).split(",")[0]?.trim();
  if (!spec) return { error: "invalid" };
  const [startStr, endStr] = spec.split("-");
  if (startStr === undefined || endStr === undefined) return { error: "invalid" };

  if (startStr === "" && endStr === "") return { error: "invalid" };

  if (startStr === "" && endStr !== "") {
    // suffix: last N bytes
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return { error: "invalid" };
    const start = Math.max(0, fileSize - n);
    return { start, end: fileSize - 1 };
  }

  const start = Number(startStr);
  if (!Number.isFinite(start) || start < 0) return { error: "invalid" };
  if (start >= fileSize) return { error: "invalid" };

  if (endStr === "") return { start, end: fileSize - 1 };

  const end = Math.min(Number(endStr), fileSize - 1);
  if (!Number.isFinite(end) || end < start) return { error: "invalid" };
  return { start, end };
}
```

- [ ] **Step 4: Run, see pass**

```bash
pnpm test tests/server/audio-stream.test.ts
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add http range parser for audio streaming"
```

---

## Task 4: `/api/audio/[trackId]` Range route handler

**Files:**
- Create: `src/app/api/audio/[trackId]/route.ts`

This serves the audio bytes. For Phase 1 it only handles local files; the YT proxy fork lands in Phase 2.

- [ ] **Step 1: Implement the route**

Create `src/app/api/audio/[trackId]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { parseRange } from "@/server/services/audio-stream";
import fs from "node:fs";
import { stat } from "node:fs/promises";

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: { filePath: true, fileFormat: true, source: true, ytVideoId: true },
  });
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Phase 1 only handles local files. YT streaming lands in Phase 2.
  if (!track.filePath) {
    return NextResponse.json({ error: "not_yet_supported", reason: track.source }, { status: 501 });
  }

  let stats;
  try {
    stats = await stat(track.filePath);
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 410 });
  }

  const size = stats.size;
  const mime = MIME_BY_EXT[track.fileFormat ?? ""] ?? "application/octet-stream";
  const rangeHeader = req.headers.get("range");
  const range = parseRange(rangeHeader, size);

  if (range && "error" in range) {
    return new NextResponse("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const { start, end } = range;
    const stream = fs.createReadStream(track.filePath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = fs.createReadStream(track.filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
```

- [ ] **Step 2: Verify the build**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/audio
git commit -m "feat: add /api/audio Range-streaming route for local files"
```

---

## Task 5: Library scanner service

**Files:**
- Create: `src/server/services/library-scanner.ts`
- Create: `tests/server/library-scanner.test.ts`

Two responsibilities: (1) `scanOnce(rootPath)` — walks the tree, ingests every audio file. (2) `startWatcher(rootPath)` — chokidar live-watches for adds/changes/removes. Both share `ingestFile(path)` which: reads ID3, computes SHA-256, upserts Artist→Album→Track, dedupes by sha256.

- [ ] **Step 1: Make Vitest load `.env` so DATABASE_URL is available**

Vitest does not auto-load `.env`. The DB-touching tests need this. Install dotenv as a dev dep if it isn't already (it should be from Phase 0):

```bash
pnpm list dotenv --depth=0 || pnpm add -D dotenv
```

Then update `tests/setup.ts` to load `.env` before tests run:

```ts
import "dotenv/config";
import "@testing-library/jest-dom/vitest";
```

Verify tests still pass:
```bash
pnpm test
```
Expected: 8/8 still pass (env + auth tests, unchanged).

- [ ] **Step 2: Write failing test for library scanner**

Create `tests/server/library-scanner.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// We test scanOnce against a real DB; that requires running Postgres.
// Skip-tag the suite if DATABASE_URL not set.
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("library-scanner", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mu-scan-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    const { db } = await import("@/server/db");
    await db.track.deleteMany({});
    await db.album.deleteMany({});
    await db.artist.deleteMany({});
  });

  it("ingests a fake file into Artist→Album→Track", async () => {
    const file = path.join(tmp, "Test.m4a");
    await fs.writeFile(file, Buffer.alloc(8));
    const { scanOnce } = await import("@/server/services/library-scanner");
    const report = await scanOnce(tmp);
    expect(report.added).toBe(1);
    const { db } = await import("@/server/db");
    const tracks = await db.track.findMany({ include: { primaryArtist: true, album: true } });
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.title).toBe("Test");
    expect(tracks[0]?.primaryArtist.name).toBe("Unknown Artist");
  });

  it("dedupes identical files by sha256", async () => {
    const a = path.join(tmp, "A.m4a");
    const b = path.join(tmp, "B.m4a");
    await fs.writeFile(a, Buffer.from("identical-content"));
    await fs.writeFile(b, Buffer.from("identical-content"));
    const { scanOnce } = await import("@/server/services/library-scanner");
    const report = await scanOnce(tmp);
    expect(report.added).toBe(1);
    expect(report.skippedDuplicates).toBe(1);
  });
});
```

- [ ] **Step 3: Run, see fail**

```bash
pnpm test tests/server/library-scanner.test.ts
```

- [ ] **Step 4: Implement**

Create `src/server/services/library-scanner.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import chokidar, { type FSWatcher } from "chokidar";
import { db } from "@/server/db";
import { readTrackMetadata } from "@/server/services/id3-reader";

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".flac", ".opus", ".ogg", ".wav"]);

export interface ScanReport {
  added: number;
  skippedDuplicates: number;
  errors: { path: string; reason: string }[];
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export async function ingestFile(filePath: string): Promise<"added" | "duplicate" | "error"> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return "error";
    const sha = await sha256(filePath);
    const existing = await db.track.findUnique({ where: { sha256: sha } });
    if (existing) return "duplicate";

    const meta = await readTrackMetadata(filePath);
    const artist = await db.artist.upsert({
      where: { name: meta.artistName },
      create: { name: meta.artistName, discoveredAt: new Date() },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: meta.albumTitle } },
      create: { title: meta.albumTitle, artistId: artist.id },
      update: {},
    });
    await db.track.create({
      data: {
        title: meta.title,
        duration: meta.durationSec,
        trackNumber: meta.trackNumber,
        discNumber: meta.discNumber,
        filePath,
        fileSize: BigInt(stats.size),
        fileFormat: meta.fileFormat,
        bitrate: meta.bitrate,
        sha256: sha,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
        discoveredAt: new Date(),
      },
    });
    return "added";
  } catch {
    return "error";
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

export async function scanOnce(rootPath: string): Promise<ScanReport> {
  const files = await walk(rootPath);
  const report: ScanReport = { added: 0, skippedDuplicates: 0, errors: [] };
  for (const file of files) {
    const result = await ingestFile(file);
    if (result === "added") report.added++;
    else if (result === "duplicate") report.skippedDuplicates++;
    else report.errors.push({ path: file, reason: "ingest_failed" });
  }
  return report;
}

let activeWatcher: FSWatcher | null = null;

export function startWatcher(rootPath: string): FSWatcher {
  if (activeWatcher) return activeWatcher;
  const watcher = chokidar.watch(rootPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1500 },
  });
  watcher
    .on("add", (filePath) => {
      if (AUDIO_EXTS.has(path.extname(filePath).toLowerCase())) {
        ingestFile(filePath).catch(() => {});
      }
    })
    .on("unlink", async (filePath) => {
      await db.track.updateMany({ where: { filePath }, data: { playable: false } });
    });
  activeWatcher = watcher;
  return watcher;
}

export async function stopWatcher(): Promise<void> {
  if (activeWatcher) {
    await activeWatcher.close();
    activeWatcher = null;
  }
}
```

- [ ] **Step 5: Run, see pass**

Make sure DB is up: `docker compose up -d db`. Then:
```bash
pnpm test tests/server/library-scanner.test.ts
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add library scanner with chokidar watcher and sha256 dedup"
```

---

## Task 6: Server actions for library + views

**Files:**
- Create: `src/server/actions/library.ts`
- Create: `src/server/actions/views.ts`
- Create: `src/lib/format-duration.ts`

- [ ] **Step 1: Create the format helper**

Create `src/lib/format-duration.ts`:
```ts
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Write the library server action**

Create `src/server/actions/library.ts`:
```ts
"use server";

import { env } from "@/lib/env";
import { scanOnce, type ScanReport } from "@/server/services/library-scanner";

export async function rescanLibrary(): Promise<ScanReport> {
  return scanOnce(env.MUSIC_LIBRARY_PATH);
}
```

- [ ] **Step 3: Write the view server actions**

Create `src/server/actions/views.ts`:
```ts
"use server";

import { db } from "@/server/db";

export async function getArtists() {
  return db.artist.findMany({
    orderBy: { sortName: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { tracks: true, albums: true } },
    },
  });
}

export async function getAlbumsByArtist(artistId: string) {
  return db.album.findMany({
    where: { artistId },
    orderBy: { releaseDate: "asc" },
    select: { id: true, title: true, coverArtPath: true, _count: { select: { tracks: true } } },
  });
}

export async function getAllAlbums() {
  return db.album.findMany({
    orderBy: [{ artist: { sortName: "asc" } }, { releaseDate: "asc" }],
    select: {
      id: true,
      title: true,
      coverArtPath: true,
      artist: { select: { id: true, name: true } },
    },
  });
}

export async function getAllSongs() {
  return db.track.findMany({
    where: { playable: true },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      duration: true,
      source: true,
      primaryArtist: { select: { id: true, name: true } },
      album: { select: { id: true, title: true, coverArtPath: true } },
    },
  });
}

export async function getTracksByAlbum(albumId: string) {
  return db.track.findMany({
    where: { albumId, playable: true },
    orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      trackNumber: true,
      source: true,
      primaryArtist: { select: { id: true, name: true } },
    },
  });
}

export async function getTracksByArtist(artistId: string) {
  return db.track.findMany({
    where: { primaryArtistId: artistId, playable: true },
    orderBy: [{ album: { releaseDate: "asc" } }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      source: true,
      album: { select: { id: true, title: true } },
    },
  });
}
```

- [ ] **Step 4: Verify**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add library + views server actions + duration formatter"
```

---

## Task 7: Zustand stores (ipod + player)

**Files:**
- Create: `src/stores/ipod-store.ts`
- Create: `src/stores/player-store.ts`
- Create: `tests/stores/ipod-store.test.ts`
- Create: `tests/stores/player-store.test.ts`

- [ ] **Step 1: Write failing test for ipod-store**

Create `tests/stores/ipod-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useIpodStore } from "@/stores/ipod-store";

describe("ipod-store", () => {
  beforeEach(() => {
    useIpodStore.setState({ navStack: [{ name: "home" }] });
  });

  it("starts with home on the stack", () => {
    expect(useIpodStore.getState().navStack).toHaveLength(1);
    expect(useIpodStore.getState().navStack[0]).toEqual({ name: "home" });
  });

  it("push() adds a screen", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    expect(useIpodStore.getState().navStack).toHaveLength(2);
    expect(useIpodStore.getState().current().name).toBe("musicSub");
  });

  it("pop() removes the top, but never empties below home", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    useIpodStore.getState().pop();
    expect(useIpodStore.getState().current().name).toBe("home");
    useIpodStore.getState().pop();
    expect(useIpodStore.getState().current().name).toBe("home"); // floor
  });

  it("toRoot() resets to home", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    useIpodStore.getState().push({ name: "artistList" });
    useIpodStore.getState().toRoot();
    expect(useIpodStore.getState().navStack).toEqual([{ name: "home" }]);
  });
});
```

- [ ] **Step 2: Write failing test for player-store**

Create `tests/stores/player-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "@/stores/player-store";

const track = (id: string) => ({ id, title: id, duration: 100, artist: "A", album: "Al" });

describe("player-store", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      shuffle: false,
      repeat: "off",
      volume: 1,
      position: 0,
    });
  });

  it("setQueue replaces the queue and sets currentIndex", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    expect(usePlayerStore.getState().queue).toHaveLength(2);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("next/prev navigate within queue", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b"), track("c")], 0);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("next at end stops when repeat=off", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("next at end wraps when repeat=all", () => {
    usePlayerStore.setState({ repeat: "all" });
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });
});
```

- [ ] **Step 3: Run, see fail**

```bash
pnpm test tests/stores
```

- [ ] **Step 4: Implement ipod-store**

Create `src/stores/ipod-store.ts`:
```ts
import { create } from "zustand";

export type ScreenState =
  | { name: "home" }
  | { name: "musicSub" }
  | { name: "artistList" }
  | { name: "artistDetail"; artistId: string }
  | { name: "albumList" }
  | { name: "albumDetail"; albumId: string }
  | { name: "songList" }
  | { name: "nowPlaying" };

interface IpodState {
  navStack: ScreenState[];
  current: () => ScreenState;
  push: (screen: ScreenState) => void;
  pop: () => void;
  toRoot: () => void;
}

export const useIpodStore = create<IpodState>((set, get) => ({
  navStack: [{ name: "home" }],
  current: () => {
    const stack = get().navStack;
    return stack[stack.length - 1] ?? { name: "home" };
  },
  push: (screen) => set((s) => ({ navStack: [...s.navStack, screen] })),
  pop: () =>
    set((s) => {
      if (s.navStack.length <= 1) return s;
      return { navStack: s.navStack.slice(0, -1) };
    }),
  toRoot: () => set({ navStack: [{ name: "home" }] }),
}));
```

- [ ] **Step 5: Implement player-store**

Create `src/stores/player-store.ts`:
```ts
import { create } from "zustand";

export interface QueueTrack {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtPath?: string | null;
}

export type RepeatMode = "off" | "one" | "all";

interface PlayerState {
  queue: QueueTrack[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  position: number;
  currentTrack: () => QueueTrack | null;
  setQueue: (queue: QueueTrack[], startIndex?: number) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  setPosition: (p: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: "off",
  volume: 1,
  position: 0,
  currentTrack: () => {
    const s = get();
    return s.queue[s.currentIndex] ?? null;
  },
  setQueue: (queue, startIndex = 0) =>
    set({ queue, currentIndex: queue.length ? Math.min(startIndex, queue.length - 1) : -1, isPlaying: queue.length > 0, position: 0 }),
  next: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      if (s.currentIndex < s.queue.length - 1) return { currentIndex: s.currentIndex + 1, position: 0 };
      if (s.repeat === "all") return { currentIndex: 0, position: 0 };
      return { isPlaying: false };
    }),
  prev: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      if (s.position > 3) return { position: 0 };
      if (s.currentIndex > 0) return { currentIndex: s.currentIndex - 1, position: 0 };
      if (s.repeat === "all") return { currentIndex: s.queue.length - 1, position: 0 };
      return { position: 0 };
    }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setShuffle: (v) => set({ shuffle: v }),
  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
  setPosition: (p) => set({ position: Math.max(0, p) }),
}));
```

- [ ] **Step 6: Run, see pass**

```bash
pnpm test tests/stores
```
Expected: 8 passed (4 ipod + 4 player).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add zustand stores for ipod navigation and player state"
```

---

## Task 8: Audio engine singleton + MediaSession

**Files:**
- Create: `src/audio/engine.ts`
- Create: `src/audio/media-session.ts`
- Create: `tests/audio/engine.test.ts`

The engine wraps one `<audio>` element. It owns: src setting, play/pause, seek, volume, position-tick events. It is driven BY the player store (engine reacts to store changes) and feeds position back into the store. MediaSession integrates with the OS lock-screen.

- [ ] **Step 1: Write failing test (logic only — DOM tested manually)**

Create `tests/audio/engine.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "@/audio/engine";

describe("audio engine", () => {
  let engine: ReturnType<typeof createEngine>;
  beforeEach(() => {
    engine = createEngine();
  });

  it("loadTrack sets src", () => {
    engine.loadTrack("track-123");
    expect(engine.getSrc()).toBe("/api/audio/track-123");
  });

  it("setVolume clamps to [0,1]", () => {
    engine.setVolume(-1);
    expect(engine.getVolume()).toBe(0);
    engine.setVolume(2);
    expect(engine.getVolume()).toBe(1);
  });

  it("seek sets currentTime", () => {
    engine.loadTrack("track-123");
    engine.seek(42);
    expect(engine.getCurrentTime()).toBe(42);
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
pnpm test tests/audio
```

- [ ] **Step 3: Implement engine**

Create `src/audio/engine.ts`:
```ts
export interface AudioEngine {
  loadTrack: (trackId: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  getSrc: () => string;
  getCurrentTime: () => number;
  getVolume: () => number;
  getDuration: () => number;
  on: (event: "timeupdate" | "ended" | "play" | "pause", handler: () => void) => () => void;
  destroy: () => void;
}

export function createEngine(): AudioEngine {
  const el = typeof document !== "undefined" ? document.createElement("audio") : ({} as HTMLAudioElement);
  el.preload = "metadata";

  return {
    loadTrack: (trackId) => {
      el.src = `/api/audio/${trackId}`;
    },
    play: async () => {
      try {
        await el.play();
      } catch {
        /* autoplay blocked or no src */
      }
    },
    pause: () => el.pause(),
    seek: (seconds) => {
      el.currentTime = seconds;
    },
    setVolume: (v) => {
      el.volume = Math.max(0, Math.min(1, v));
    },
    getSrc: () => el.src,
    getCurrentTime: () => el.currentTime || 0,
    getVolume: () => el.volume,
    getDuration: () => el.duration || 0,
    on: (event, handler) => {
      el.addEventListener(event, handler);
      return () => el.removeEventListener(event, handler);
    },
    destroy: () => {
      el.pause();
      el.removeAttribute("src");
    },
  };
}

let singleton: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (!singleton) singleton = createEngine();
  return singleton;
}
```

- [ ] **Step 4: Implement media-session**

Create `src/audio/media-session.ts`:
```ts
import type { QueueTrack } from "@/stores/player-store";

export interface MediaSessionActions {
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekTo: (seconds: number) => void;
}

export function bindMediaSession(actions: MediaSessionActions): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => {};
  }
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", actions.onPlay);
  ms.setActionHandler("pause", actions.onPause);
  ms.setActionHandler("previoustrack", actions.onPrev);
  ms.setActionHandler("nexttrack", actions.onNext);
  ms.setActionHandler("seekto", (e) => {
    if (typeof e.seekTime === "number") actions.onSeekTo(e.seekTime);
  });
  return () => {
    ms.setActionHandler("play", null);
    ms.setActionHandler("pause", null);
    ms.setActionHandler("previoustrack", null);
    ms.setActionHandler("nexttrack", null);
    ms.setActionHandler("seekto", null);
  };
}

export function updateMediaMetadata(track: QueueTrack | null): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.coverArtPath
      ? [{ src: track.coverArtPath, sizes: "512x512", type: "image/jpeg" }]
      : [],
  });
}
```

- [ ] **Step 5: Run, see pass**

```bash
pnpm test tests/audio
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add audio engine singleton and media session integration"
```

---

## Task 9: ClickWheel component

**Files:**
- Create: `src/components/ipod/wheel-gestures.ts`
- Create: `src/components/ipod/ClickWheel.tsx`
- Create: `tests/components/ipod/ClickWheel.test.tsx`

The ClickWheel emits 6 events. Layers:
1. **Keyboard** — `↑↓` = scroll, `Enter` = select, `Esc`/`Backspace` = menu, `Space` = playPause, `←→` = prev/next.
2. **Mouse wheel** — wheel down = scroll(+1), up = scroll(-1).
3. **Pointer drag on rim** — circular drag emits scroll events on angular delta > threshold.
4. **Cardinal tap zones** — N=MENU, E=⏭, S=⏯, W=⏮, center=select.

- [ ] **Step 1: Write failing component test**

Create `tests/components/ipod/ClickWheel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ClickWheel } from "@/components/ipod/ClickWheel";

describe("ClickWheel", () => {
  it("emits scroll on ArrowDown / ArrowUp", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    (wheel as HTMLElement).focus();
    fireEvent.keyDown(wheel, { key: "ArrowDown" });
    fireEvent.keyDown(wheel, { key: "ArrowUp" });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: 1 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: -1 });
  });

  it("emits select on Enter, menu on Escape, playPause on Space", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    (wheel as HTMLElement).focus();
    fireEvent.keyDown(wheel, { key: "Enter" });
    fireEvent.keyDown(wheel, { key: "Escape" });
    fireEvent.keyDown(wheel, { key: " " });
    expect(onEvent).toHaveBeenCalledWith({ type: "select" });
    expect(onEvent).toHaveBeenCalledWith({ type: "menu" });
    expect(onEvent).toHaveBeenCalledWith({ type: "playPause" });
  });

  it("emits scroll on mouse wheel", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    fireEvent.wheel(wheel, { deltaY: 100 });
    fireEvent.wheel(wheel, { deltaY: -100 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: 1 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: -1 });
  });

  it("emits menu/next/playPause/prev on cardinal taps", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    container.querySelector('[data-zone="menu"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="next"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="playPause"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="prev"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="select"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onEvent).toHaveBeenCalledWith({ type: "menu" });
    expect(onEvent).toHaveBeenCalledWith({ type: "next" });
    expect(onEvent).toHaveBeenCalledWith({ type: "playPause" });
    expect(onEvent).toHaveBeenCalledWith({ type: "prev" });
    expect(onEvent).toHaveBeenCalledWith({ type: "select" });
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
pnpm test tests/components
```

- [ ] **Step 3: Implement wheel-gestures helper**

Create `src/components/ipod/wheel-gestures.ts`:
```ts
export interface WheelGestureState {
  lastAngle: number | null;
  accumulator: number;
}

const SCROLL_ANGLE_THRESHOLD = 15; // degrees

export function computeAngularDelta(state: WheelGestureState, x: number, y: number, cx: number, cy: number): { delta: number; newState: WheelGestureState } {
  const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
  if (state.lastAngle === null) {
    return { delta: 0, newState: { lastAngle: angle, accumulator: 0 } };
  }
  let diff = angle - state.lastAngle;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  const newAccumulator = state.accumulator + diff;
  if (Math.abs(newAccumulator) >= SCROLL_ANGLE_THRESHOLD) {
    const delta = newAccumulator > 0 ? 1 : -1;
    return { delta, newState: { lastAngle: angle, accumulator: newAccumulator % SCROLL_ANGLE_THRESHOLD } };
  }
  return { delta: 0, newState: { lastAngle: angle, accumulator: newAccumulator } };
}

export function resetGesture(): WheelGestureState {
  return { lastAngle: null, accumulator: 0 };
}
```

- [ ] **Step 4: Implement ClickWheel**

Create `src/components/ipod/ClickWheel.tsx`:
```tsx
"use client";

import { useRef, type KeyboardEvent, type WheelEvent, type PointerEvent } from "react";
import { computeAngularDelta, resetGesture, type WheelGestureState } from "./wheel-gestures";

export type WheelEventOut =
  | { type: "scroll"; delta: -1 | 1 }
  | { type: "select" }
  | { type: "menu" }
  | { type: "prev" }
  | { type: "next" }
  | { type: "playPause" };

export interface ClickWheelProps {
  onEvent: (e: WheelEventOut) => void;
  size?: number;
}

export function ClickWheel({ onEvent, size = 220 }: ClickWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<WheelGestureState>(resetGesture());
  const dragging = useRef(false);

  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        onEvent({ type: "scroll", delta: 1 });
        break;
      case "ArrowUp":
        e.preventDefault();
        onEvent({ type: "scroll", delta: -1 });
        break;
      case "Enter":
        e.preventDefault();
        onEvent({ type: "select" });
        break;
      case "Escape":
      case "Backspace":
        e.preventDefault();
        onEvent({ type: "menu" });
        break;
      case " ":
        e.preventDefault();
        onEvent({ type: "playPause" });
        break;
      case "ArrowLeft":
        e.preventDefault();
        onEvent({ type: "prev" });
        break;
      case "ArrowRight":
        e.preventDefault();
        onEvent({ type: "next" });
        break;
    }
  }

  function handleMouseWheel(e: WheelEvent) {
    if (e.deltaY === 0) return;
    onEvent({ type: "scroll", delta: e.deltaY > 0 ? 1 : -1 });
  }

  function handlePointerDown(e: PointerEvent) {
    dragging.current = true;
    gesture.current = resetGesture();
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging.current || !wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const { delta, newState } = computeAngularDelta(gesture.current, e.clientX, e.clientY, cx, cy);
    gesture.current = newState;
    if (delta !== 0) onEvent({ type: "scroll", delta: delta as -1 | 1 });
  }

  function handlePointerUp(e: PointerEvent) {
    dragging.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={wheelRef}
      data-testid="clickwheel"
      role="application"
      aria-label="iPod click wheel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleMouseWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative select-none rounded-full bg-gradient-to-b from-zinc-100 to-zinc-300 outline-none ring-zinc-400 focus:ring-2"
      style={{ width: size, height: size, touchAction: "none" }}
    >
      {/* Cardinal tap zones */}
      <button
        type="button"
        data-zone="menu"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "menu" });
        }}
        className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-bold text-zinc-600"
      >
        MENU
      </button>
      <button
        type="button"
        data-zone="next"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "next" });
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
      >
        ⏭
      </button>
      <button
        type="button"
        data-zone="playPause"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "playPause" });
        }}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 text-zinc-600"
      >
        ⏯
      </button>
      <button
        type="button"
        data-zone="prev"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "prev" });
        }}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
      >
        ⏮
      </button>
      {/* Center select button */}
      <button
        type="button"
        data-zone="select"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "select" });
        }}
        aria-label="select"
        className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-white to-zinc-300 shadow-inner"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run, see pass**

```bash
pnpm test tests/components
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add click wheel component with kbd/scroll/drag/tap layers"
```

---

## Task 10: Chassis + Screen + screens (HomeMenu, MusicSub)

**Files:**
- Create: `src/components/ipod/Chassis.tsx`
- Create: `src/components/ipod/Screen.tsx`
- Create: `src/components/ipod/screens/HomeMenu.tsx`
- Create: `src/components/ipod/screens/MusicSub.tsx`

- [ ] **Step 1: Implement Chassis**

Create `src/components/ipod/Chassis.tsx`:
```tsx
import type { ReactNode } from "react";

export interface ChassisProps {
  screen: ReactNode;
  wheel: ReactNode;
}

export function Chassis({ screen, wheel }: ChassisProps) {
  return (
    <div className="mx-auto w-[280px] rounded-[28px] border border-zinc-400 bg-gradient-to-b from-zinc-100 via-zinc-200 to-zinc-400 p-5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="mb-4 overflow-hidden rounded-md border-[3px] border-zinc-900 bg-[#d8e0c8] shadow-inner">
        <div className="h-[200px] w-full font-[Lucida_Grande,Helvetica,sans-serif] text-[11px] text-black">
          {screen}
        </div>
      </div>
      {wheel}
    </div>
  );
}
```

- [ ] **Step 2: Implement Screen**

Create `src/components/ipod/Screen.tsx`:
```tsx
"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { HomeMenu } from "./screens/HomeMenu";
import { MusicSub } from "./screens/MusicSub";
import { ArtistList } from "./screens/ArtistList";
import { AlbumList } from "./screens/AlbumList";
import { SongList } from "./screens/SongList";
import { NowPlaying } from "./screens/NowPlaying";

export function Screen() {
  const current = useIpodStore((s) => s.current());
  switch (current.name) {
    case "home":
      return <HomeMenu />;
    case "musicSub":
      return <MusicSub />;
    case "artistList":
      return <ArtistList />;
    case "albumList":
      return <AlbumList />;
    case "songList":
      return <SongList />;
    case "nowPlaying":
      return <NowPlaying />;
    default:
      return null;
  }
}
```

(Imports for `ArtistList`, `AlbumList`, `SongList`, `NowPlaying` will resolve in Task 11/12.)

- [ ] **Step 3: Implement HomeMenu**

Create `src/components/ipod/screens/HomeMenu.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useIpodStore, type ScreenState } from "@/stores/ipod-store";

const items: { label: string; target: ScreenState }[] = [
  { label: "Music", target: { name: "musicSub" } },
  { label: "Now Playing", target: { name: "nowPlaying" } },
];

export function HomeMenu({ selected: initialSelected = 0 }: { selected?: number } = {}) {
  const push = useIpodStore((s) => s.push);
  const [selected] = useState(initialSelected);
  return (
    <div className="h-full">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        iPod
      </div>
      <ul>
        {items.map((it, i) => (
          <li
            key={it.label}
            data-screen-row={it.label}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i === selected ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white" : "")
            }
          >
            <span>{it.label}</span>
            <span>›</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-2 text-[9px] text-zinc-700">
        Use ↑↓ + Enter, mouse wheel, or drag the wheel rim.
      </p>
    </div>
  );
}
```

Note: this Phase-1 HomeMenu uses local state for the selected index and doesn't yet react to wheel events. Wiring of wheel→selection happens in Task 13 alongside the iPod page.

- [ ] **Step 4: Implement MusicSub**

Create `src/components/ipod/screens/MusicSub.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useIpodStore, type ScreenState } from "@/stores/ipod-store";

const items: { label: string; target: ScreenState }[] = [
  { label: "Artists", target: { name: "artistList" } },
  { label: "Albums", target: { name: "albumList" } },
  { label: "Songs", target: { name: "songList" } },
];

export function MusicSub() {
  const [selected] = useState(0);
  return (
    <div className="h-full">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Music
      </div>
      <ul>
        {items.map((it, i) => (
          <li
            key={it.label}
            data-screen-row={it.label}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i === selected ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white" : "")
            }
          >
            <span>{it.label}</span>
            <span>›</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add chassis, screen state switch, and static menu screens"
```

---

## Task 11: Virtualized list + data list screens

**Files:**
- Create: `src/components/ipod/screens/VirtualizedList.tsx`
- Create: `src/components/ipod/screens/ArtistList.tsx`
- Create: `src/components/ipod/screens/AlbumList.tsx`
- Create: `src/components/ipod/screens/SongList.tsx`

A shared `VirtualizedList` primitive renders a virtualized list inside the 200px iPod screen. Each of ArtistList/AlbumList/SongList wraps it with a server-loaded payload.

- [ ] **Step 1: Implement VirtualizedList**

Create `src/components/ipod/screens/VirtualizedList.tsx`:
```tsx
"use client";

import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface Row {
  key: string;
  label: string;
  trailing?: string;
}

export interface VirtualizedListProps {
  title: string;
  rows: Row[];
  selected: number;
  onSelect?: (index: number) => void;
}

const ROW_HEIGHT = 16;

export function VirtualizedList({ title, rows, selected }: VirtualizedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(selected, { align: "auto" });
  }, [selected, virtualizer]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {title}
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-virtual-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
                className={
                  "flex items-center justify-between border-b border-black/5 px-2 " +
                  (vi.index === selected
                    ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                    : "")
                }
              >
                <span className="truncate">{row.label}</span>
                {row.trailing && <span className="ml-2 text-[9px] opacity-70">{row.trailing}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement ArtistList (loads via server action)**

Create `src/components/ipod/screens/ArtistList.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getArtists } from "@/server/actions/views";

export function ArtistList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getArtists().then((artists) => {
      if (cancelled) return;
      setRows(
        artists.map((a) => ({
          key: a.id,
          label: a.name,
          trailing: `${a._count.albums}`,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-center">
          <div className="text-[11px]">No artists yet.</div>
          <div className="mt-1 text-[9px] opacity-70">Settings → Rescan Library</div>
        </div>
      </div>
    );
  }

  return <VirtualizedList title="Artists" rows={rows} selected={selected} />;
}
```

- [ ] **Step 3: Implement AlbumList**

Create `src/components/ipod/screens/AlbumList.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getAllAlbums } from "@/server/actions/views";

export function AlbumList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAllAlbums().then((albums) => {
      if (cancelled) return;
      setRows(
        albums.map((a) => ({
          key: a.id,
          label: a.title,
          trailing: a.artist.name,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-[11px]">No albums yet.</div>
      </div>
    );
  }

  return <VirtualizedList title="Albums" rows={rows} selected={selected} />;
}
```

- [ ] **Step 4: Implement SongList**

Create `src/components/ipod/screens/SongList.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getAllSongs } from "@/server/actions/views";
import { formatDuration } from "@/lib/format-duration";

export function SongList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAllSongs().then((songs) => {
      if (cancelled) return;
      setRows(
        songs.map((s) => ({
          key: s.id,
          label: s.title,
          trailing: formatDuration(s.duration),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-[11px]">No songs yet.</div>
      </div>
    );
  }

  return <VirtualizedList title="Songs" rows={rows} selected={selected} />;
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add virtualized list primitive and artist/album/song screens"
```

---

## Task 12: NowPlaying screen

**Files:**
- Create: `src/components/ipod/screens/NowPlaying.tsx`

- [ ] **Step 1: Implement**

Create `src/components/ipod/screens/NowPlaying.tsx`:
```tsx
"use client";

import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

export function NowPlaying() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const track = queue[currentIndex] ?? null;

  if (!track) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-[11px]">Nothing playing.</div>
      </div>
    );
  }

  const progress = track.duration > 0 ? Math.min(1, position / track.duration) : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Now Playing
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2">
        <div className="h-16 w-16 rounded-sm bg-gradient-to-br from-[#5b7fb8] to-[#2a3a55] shadow-md" />
        <div className="mt-1 truncate text-center font-semibold">{track.title}</div>
        <div className="truncate text-center text-[10px] text-zinc-700">{track.artist}</div>
        <div className="truncate text-center text-[9px] text-zinc-600">{track.album}</div>
        <div className="mt-2 w-[95%]">
          <div className="h-1 w-full rounded bg-black/20">
            <div className="h-full rounded bg-black/70" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-zinc-700">
            <span>{formatDuration(position)}</span>
            <span className="flex gap-1">
              {shuffle && <span>⇄</span>}
              {repeat !== "off" && <span>{repeat === "one" ? "🔂" : "🔁"}</span>}
              {!isPlaying && <span>⏸</span>}
            </span>
            <span>−{formatDuration(Math.max(0, track.duration - position))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add now playing screen"
```

---

## Task 13: iPod page wiring (navigation FSM + audio engine ↔ store)

**Files:**
- Create: `src/components/ipod/Ipod.tsx`
- Modify: `src/app/page.tsx`

This is the big integration step. `Ipod.tsx` owns:
- The `selected` index per screen state (used by HomeMenu/MusicSub/lists). Lifts the per-screen `selected` from local state up to here.
- Maps ClickWheel events to navigation + playback actions.
- Subscribes to player store changes and drives the audio engine.
- Hold-MENU → toRoot detection (timer-based).

Phase 1 simplification: implement a single `selected` per current screen, reset on push. Full per-screen selected history can be added in Phase 3.

- [ ] **Step 1: Implement Ipod**

Create `src/components/ipod/Ipod.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Chassis } from "./Chassis";
import { ClickWheel, type WheelEventOut } from "./ClickWheel";
import { Screen } from "./Screen";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";
import { bindMediaSession, updateMediaMetadata } from "@/audio/media-session";
import {
  getAllAlbums,
  getAllSongs,
  getArtists,
} from "@/server/actions/views";

const HOLD_MENU_MS = 600;

export function Ipod() {
  const current = useIpodStore((s) => s.current());
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const toRoot = useIpodStore((s) => s.toRoot);

  const player = usePlayerStore();
  const [selected, setSelected] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const menuDownAt = useRef<number | null>(null);

  // Reset selection when screen changes
  useEffect(() => {
    setSelected(0);
    void (async () => {
      if (current.name === "home") setRowCount(2);
      else if (current.name === "musicSub") setRowCount(3);
      else if (current.name === "artistList") setRowCount((await getArtists()).length);
      else if (current.name === "albumList") setRowCount((await getAllAlbums()).length);
      else if (current.name === "songList") setRowCount((await getAllSongs()).length);
      else setRowCount(0);
    })();
  }, [current.name]);

  // Audio engine effect: load track when currentIndex changes
  useEffect(() => {
    const engine = getEngine();
    const track = player.queue[player.currentIndex];
    if (!track) return;
    engine.loadTrack(track.id);
    updateMediaMetadata(track);
    if (player.isPlaying) void engine.play();
  }, [player.currentIndex, player.queue]);

  // Play/pause sync
  useEffect(() => {
    const engine = getEngine();
    if (player.isPlaying) void engine.play();
    else engine.pause();
  }, [player.isPlaying]);

  // Volume sync
  useEffect(() => {
    getEngine().setVolume(player.volume);
  }, [player.volume]);

  // Time tick → store
  useEffect(() => {
    const engine = getEngine();
    return engine.on("timeupdate", () => {
      usePlayerStore.getState().setPosition(engine.getCurrentTime());
    });
  }, []);

  // Auto-advance on end
  useEffect(() => {
    return getEngine().on("ended", () => {
      usePlayerStore.getState().next();
    });
  }, []);

  // Media session
  useEffect(() => {
    return bindMediaSession({
      onPlay: () => usePlayerStore.setState({ isPlaying: true }),
      onPause: () => usePlayerStore.setState({ isPlaying: false }),
      onPrev: () => usePlayerStore.getState().prev(),
      onNext: () => usePlayerStore.getState().next(),
      onSeekTo: (s) => {
        getEngine().seek(s);
        usePlayerStore.setState({ position: s });
      },
    });
  }, []);

  async function handleSelect() {
    const sel = selected;
    if (current.name === "home") {
      if (sel === 0) push({ name: "musicSub" });
      else if (sel === 1) push({ name: "nowPlaying" });
    } else if (current.name === "musicSub") {
      if (sel === 0) push({ name: "artistList" });
      else if (sel === 1) push({ name: "albumList" });
      else if (sel === 2) push({ name: "songList" });
    } else if (current.name === "songList") {
      const songs = await getAllSongs();
      const queue = songs.map((s) => ({
        id: s.id,
        title: s.title,
        duration: s.duration,
        artist: s.primaryArtist.name,
        album: s.album?.title ?? "",
        coverArtPath: s.album?.coverArtPath ?? null,
      }));
      usePlayerStore.getState().setQueue(queue, sel);
      push({ name: "nowPlaying" });
    }
  }

  function handleEvent(e: WheelEventOut) {
    switch (e.type) {
      case "scroll":
        if (rowCount > 0) {
          setSelected((s) => Math.max(0, Math.min(rowCount - 1, s + e.delta)));
        }
        break;
      case "select":
        void handleSelect();
        break;
      case "menu":
        if (menuDownAt.current === null) {
          menuDownAt.current = Date.now();
          setTimeout(() => {
            if (menuDownAt.current !== null && Date.now() - menuDownAt.current >= HOLD_MENU_MS) {
              toRoot();
              menuDownAt.current = null;
            }
          }, HOLD_MENU_MS);
        }
        pop();
        menuDownAt.current = null;
        break;
      case "playPause":
        usePlayerStore.getState().togglePlay();
        break;
      case "next":
        usePlayerStore.getState().next();
        break;
      case "prev":
        usePlayerStore.getState().prev();
        break;
    }
  }

  // Inject selected into screens via a context-less approach:
  // we re-render screens via the Screen component which reads
  // `current` from the store. For Phase 1 we pass selection via
  // a CSS attribute on the container the screens query — quick &
  // dirty, replaced with a screen-selection-context in Phase 3.
  // For now screens use their own internal selected=0 and ignore
  // ours visually except by the wheel handler driving navigation.

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <div data-selected={selected} data-row-count={rowCount}>
        <Chassis screen={<Screen />} wheel={<ClickWheel onEvent={handleEvent} />} />
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Selected: {selected} / {Math.max(0, rowCount - 1)}
      </p>
    </main>
  );
}
```

**Important Phase 1 limitation:** The `selected` index lives in `Ipod.tsx` while the individual screens currently render their own `selected={0}`. The visual highlight on the screen lags the actual wheel-driven selection until Task 14 wires it through. Task 14 will refactor screens to take a `selected` prop. For now, navigation works (Select pushes the right screen, Menu pops); only the visual blue-bar position is locked to row 0.

- [ ] **Step 2: Replace placeholder home page**

Replace `src/app/page.tsx`:
```tsx
import { Ipod } from "@/components/ipod/Ipod";

export default function Home() {
  return <Ipod />;
}
```

- [ ] **Step 3: Verify**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire ipod page — navigation, audio engine, media session"
```

---

## Task 14: Wire screen selection through props

**Files:**
- Modify: `src/components/ipod/Screen.tsx`, all screens, `src/components/ipod/Ipod.tsx`

Now that navigation works, propagate the `selected` index from `Ipod.tsx` down through `Screen.tsx` into each screen so the highlight bar visibly moves.

- [ ] **Step 1: Change screens to accept `selected` prop**

For each of `HomeMenu`, `MusicSub`, `ArtistList`, `AlbumList`, `SongList`, replace the local `const [selected] = useState(0)` with `selected` taken from props:

```tsx
export function HomeMenu({ selected = 0 }: { selected?: number }) { /* same render, no useState */ }
export function MusicSub({ selected = 0 }: { selected?: number }) { ... }
export function ArtistList({ selected = 0 }: { selected?: number }) { ... }
export function AlbumList({ selected = 0 }: { selected?: number }) { ... }
export function SongList({ selected = 0 }: { selected?: number }) { ... }
```

The `NowPlaying` screen doesn't take `selected`.

- [ ] **Step 2: Pipe selected through Screen.tsx**

Replace `src/components/ipod/Screen.tsx`:
```tsx
"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { HomeMenu } from "./screens/HomeMenu";
import { MusicSub } from "./screens/MusicSub";
import { ArtistList } from "./screens/ArtistList";
import { AlbumList } from "./screens/AlbumList";
import { SongList } from "./screens/SongList";
import { NowPlaying } from "./screens/NowPlaying";

export interface ScreenProps {
  selected: number;
}

export function Screen({ selected }: ScreenProps) {
  const current = useIpodStore((s) => s.current());
  switch (current.name) {
    case "home":
      return <HomeMenu selected={selected} />;
    case "musicSub":
      return <MusicSub selected={selected} />;
    case "artistList":
      return <ArtistList selected={selected} />;
    case "albumList":
      return <AlbumList selected={selected} />;
    case "songList":
      return <SongList selected={selected} />;
    case "nowPlaying":
      return <NowPlaying />;
    default:
      return null;
  }
}
```

- [ ] **Step 3: Pass selected to Screen in Ipod.tsx**

In `Ipod.tsx`, change `<Screen />` to `<Screen selected={selected} />`.

- [ ] **Step 4: Verify**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pipe selection state from ipod into screens for visible highlight"
```

---

## Task 15: Playback recording (startPlay / updatePlayProgress)

**Files:**
- Create: `src/server/actions/playback.ts`
- Modify: `src/components/ipod/Ipod.tsx` (wire to engine timeupdate)

- [ ] **Step 1: Implement actions**

Create `src/server/actions/playback.ts`:
```ts
"use server";

import { db } from "@/server/db";

export async function startPlay(trackId: string): Promise<string> {
  const history = await db.listeningHistory.create({
    data: {
      trackId,
      source: "LOCAL_FILE",
      durationListened: 0,
      completed: false,
    },
    select: { id: true },
  });
  return history.id;
}

export async function updatePlayProgress(historyId: string, secondsListened: number, completed: boolean): Promise<void> {
  await db.listeningHistory.update({
    where: { id: historyId },
    data: { durationListened: Math.round(secondsListened), completed },
  });
}
```

- [ ] **Step 2: Wire in Ipod.tsx**

Add to `Ipod.tsx` near the other audio effects (replace the existing time-tick effect with this enhanced version):

```tsx
// Playback recording
const historyIdRef = useRef<string | null>(null);
const lastReportedSecondRef = useRef(0);

useEffect(() => {
  const track = player.queue[player.currentIndex];
  if (!track || !player.isPlaying) return;
  void startPlay(track.id).then((id) => {
    historyIdRef.current = id;
    lastReportedSecondRef.current = 0;
  });
}, [player.currentIndex, player.isPlaying]);

useEffect(() => {
  const engine = getEngine();
  return engine.on("timeupdate", () => {
    const t = engine.getCurrentTime();
    usePlayerStore.getState().setPosition(t);
    const track = player.queue[player.currentIndex];
    if (historyIdRef.current && track) {
      // throttle updates: every ~5 seconds
      if (Math.floor(t) - lastReportedSecondRef.current >= 5) {
        const completed = t / track.duration >= 0.8;
        void updatePlayProgress(historyIdRef.current, t, completed);
        lastReportedSecondRef.current = Math.floor(t);
      }
    }
  });
}, [player.currentIndex, player.queue]);
```

Also add these to the top imports:
```ts
import { startPlay, updatePlayProgress } from "@/server/actions/playback";
import { useRef } from "react";
```

- [ ] **Step 3: Verify**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: record listening history on play start + progress updates"
```

---

## Task 16: iPod-styled login screen

**Files:**
- Modify: `src/app/login/page.tsx`

- [ ] **Step 1: Replace with iPod-styled login**

Replace `src/app/login/page.tsx`:
```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chassis } from "@/components/ipod/Chassis";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Wrong password.");
      return;
    }
    router.replace("/");
  }

  const screen = (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        iPod
      </div>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col items-center justify-center gap-2 p-3">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-black/30 bg-white/60 px-2 py-1 text-[11px] text-black outline-none focus:bg-white"
        />
        {error && <p className="text-[9px] text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          className="w-full rounded bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {pending ? "…" : "Enter"}
        </button>
      </form>
    </div>
  );

  const fakeWheel = (
    <div className="mx-auto h-[220px] w-[220px] rounded-full bg-gradient-to-b from-zinc-100 to-zinc-300 opacity-40" />
  );

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <Chassis screen={screen} wheel={fakeWheel} />
    </main>
  );
}
```

- [ ] **Step 2: Verify**

```bash
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: replace plain login with ipod-chassis-styled login"
```

---

## Task 17: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Prepare a small test library**

```bash
# Pick a folder with a handful of m4a/mp3 files
ls "$YOUR_MUSIC_FOLDER"   # confirm it has at least 3-5 audio files
```

Update `.env` so `MUSIC_LIBRARY_PATH` points there:
```env
MUSIC_LIBRARY_PATH="/Users/fwzfhmy/Music/test-set"
```

- [ ] **Step 2: Boot**

```bash
docker compose up -d db
pnpm dev
```

- [ ] **Step 3: Log in and trigger initial scan**

Open `http://localhost:3000`, log in. You should land on the iPod home screen showing `Music` / `Now Playing`.

Trigger a scan by calling the server action from the dev console:
```js
// In browser dev tools console:
await fetch("/api/audio/dummy")   // confirms route exists (404 ok)
```

Actually — Phase 1 doesn't ship a rescan UI yet (that lands in Settings → Library in Phase 3). For now, run the scan via a one-shot script:

```bash
pnpm exec node --experimental-strip-types -e "
import { scanOnce } from './src/server/services/library-scanner.ts';
scanOnce(process.env.MUSIC_LIBRARY_PATH).then(r => { console.log(r); process.exit(0); });
"
```

Expected: `{ added: N, skippedDuplicates: 0, errors: [] }`.

- [ ] **Step 4: Verify the iPod browses your music**

Reload the page. Click MENU button → Music → Artists. You should see at least one artist row. Press Enter / center button → currently navigates to nowPlaying (full hierarchy navigation is Phase 3). Press Menu / Escape to go back.

- [ ] **Step 5: Verify playback works**

Navigate to Songs (via Music → Songs). Use ↑/↓ to highlight a song. Press Enter — the iPod should push the NowPlaying screen and audio should start playing from `/api/audio/[trackId]`.

Press Space → pause/play. Press → / ← → next/prev. Open Safari/Chrome lock-screen control (Cmd+F to focus media controls if on macOS) — track metadata should appear.

- [ ] **Step 6: Verify history recorded**

```bash
docker compose exec db psql -U music -d music_universe -c "SELECT count(*), max(\"playedAt\") FROM \"ListeningHistory\";"
```

Expected: at least 1 row with a recent `playedAt`.

- [ ] **Step 7: Final checks**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm exec eslint .
pnpm exec next build 2>&1 | tail -10
```

All four must be clean.

- [ ] **Step 8: Final commit if anything was tweaked**

```bash
git status
# if anything to commit:
git add -A
git commit -m "chore: phase 1 manual verification complete"
```

---

## Self-Review Notes (for the engineer)

**Spec coverage** — Phase 1 covers spec §7 Phase 1 (Library + Player core) plus the iPod-styled login deferred from Phase 0. Out of scope: ArtistDetail / AlbumDetail navigation (these screens are stubs that arrive in Phase 4 alongside metadata), Search (Phase 2), Notes/Tags/Favorites/Playlists CRUD (Phase 3), Stats/Wrapped (Phase 5).

**Known Phase 1 limitations** (intentional):
- Pressing Enter on an artist or album row falls through to nowPlaying instead of drilling in. ArtistDetail/AlbumDetail screens land in Phase 4.
- `selected` per screen does not persist across navigation pushes — drilling into Songs and coming back loses the previous cursor position. Per-screen selection memory lands in Phase 3.
- Rescan UI is missing. We use a CLI one-shot for Phase 1 manual verification; the Settings → Library → Rescan UI lands in Phase 3.
- File watcher (`startWatcher`) is implemented but never started by Phase 1 — `scanOnce` covers all current needs. The watcher will be started from a Next.js `instrumentation.ts` hook in Phase 3.

**TDD scope decisions:** Services (id3-reader, library-scanner, audio-stream) + stores + ClickWheel got real tests. Screens got smoke-only (or none) — they're mostly layout. The audio engine got jsdom-based unit tests for the pure logic; full audio playback is verified manually in Task 17.

**Per-file vitest environment:** Tests under `tests/components/` and `tests/audio/` use `// @vitest-environment jsdom`. Everything else defaults to node.

**Database in tests:** `library-scanner.test.ts` requires a running Postgres and writes to the actual DB (cleared in `afterEach`). Skip the test if `DATABASE_URL` is unset — the test file uses `describe.skipIf(!RUN)`.
