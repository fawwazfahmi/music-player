# Phase 1 — Genres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a listener browse the library by genre, with genres populated automatically (MusicBrainz → local Ollama fallback) and editable by hand.

**Architecture:** Genres mirror the existing **Tags** subsystem almost exactly. A new `TrackGenre` join table hangs song-level genres off the existing `Genre` model. A pure normalization lib, a set of `"use server"` query/edit actions, a browse page + detail page wired into the `ipod-store` navigation stack, and a population pipeline: a `genre-tagger` service (MusicBrainz first, Ollama fallback) called from the metadata worker for new tracks and a backfill script for existing ones. This phase also stands up the **Ollama service skeleton** (`mood-llm.ts`) that later phases build on, de-risking it early.

**Tech Stack:** Next.js 16 (App Router, React Server Actions), React 19, Prisma 7 + PostgreSQL, Zustand, Tailwind, Vitest, pnpm. Local Ollama over HTTP (no new npm dependency — plain `fetch`).

## Global Constraints

- **Package manager is `pnpm`.** Run tests with `pnpm exec vitest run <file>`, migrations with `pnpm db:migrate`, client generation with `pnpm db:generate`, typecheck with `pnpm exec tsc --noEmit`, lint with `pnpm lint`.
- **This is NOT stock Next.js** (per `AGENTS.md`): before using any Next.js *API* you're unsure of, read the relevant guide in `node_modules/next/dist/docs/`. This phase reuses existing patterns (client components + `"use server"` actions) and introduces no new Next.js APIs, so no new reading should be required — but honor this if you deviate.
- **`"use server"` files may only export `async` functions.** Never put a synchronous helper (e.g. `normalizeGenre`) in a `"use server"` file — put pure helpers in `src/lib/`.
- **DB-touching tests are guarded** with `describe.skipIf(!process.env.DATABASE_URL)` and must clean up everything they create (see `tests/server/playlists.test.ts`). Service tests mock `fetch` with `vi.stubGlobal` + dynamic `import()` after `vi.resetModules()` (see `tests/server/musicbrainz.test.ts`).
- **Ollama is never a hard dependency.** Any Ollama call must degrade gracefully (return empty / skip) when the server is unreachable, and never throw into a caller that would break playback, population, or a page load.
- **TDD, DRY, YAGNI, frequent commits.** One logical change per commit; each task ends green.

---

## File Structure

**New files:**
- `src/lib/genre.ts` — pure genre-name helpers (`normalizeGenre`, `displayGenre`).
- `src/server/actions/genres.ts` — `"use server"` query + manual-edit actions.
- `src/server/services/mood-llm.ts` — Ollama client skeleton (`classifyGenre`, internal JSON generate helper).
- `src/server/services/genre-tagger.ts` — orchestrates MB→Ollama population, writes `Genre`/`TrackGenre`/`ArtistGenre`.
- `src/components/pages/GenresPage.tsx` — browse grid of genres.
- `src/components/pages/GenreDetailPage.tsx` — songs within one genre.
- `src/components/genres/GenreEditor.tsx` — per-track manual add/remove (mirrors `TagEditor`).
- `scripts/backfill-genres.ts` — populate genres for existing tracks.
- Test files listed per task.

**Modified files:**
- `prisma/schema.prisma` — add `TrackGenre` model + relations on `Track` and `Genre`.
- `src/lib/env.ts` + `.env.example` — add `OLLAMA_URL`, `OLLAMA_MODEL`.
- `src/server/services/musicbrainz.ts` — add `getGenres()`.
- `src/server/services/metadata-worker.ts` — call `tagTrackGenres` after enrichment.
- `src/stores/ipod-store.ts` — add `genreList` / `genreDetail` screen states + `screenKey`.
- `src/components/pages/MainContent.tsx` — route the two new screens.
- `src/components/layout/Sidebar.tsx` — add a **Genres** nav item.
- `src/components/icons.tsx` — add `GenreIcon`.
- `src/components/pages/NotesPage.tsx` — render `<GenreEditor>` beside `<TagEditor>`.

---

## Task 1: `TrackGenre` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (the `Track` model, the `Genre` model; add a new `TrackGenre` model)

**Interfaces:**
- Produces: Prisma model `TrackGenre { trackId, genreId }` with compound id `@@id([trackId, genreId])`; `Track.genres: TrackGenre[]`; `Genre.tracks: TrackGenre[]`. Later tasks rely on `db.trackGenre`, `db.genre`.

- [ ] **Step 1: Add the relation field to `Track`**

In `prisma/schema.prisma`, inside `model Track`, add alongside the other relation fields (near `tags TrackTag[]`):

```prisma
  genres            TrackGenre[]
```

- [ ] **Step 2: Add the relation field to `Genre`**

In `model Genre`, add `tracks` beside the existing `artists`/`albums`:

```prisma
model Genre {
  id      String        @id @default(cuid())
  name    String        @unique
  mbid    String?       @unique
  artists ArtistGenre[]
  albums  AlbumGenre[]
  tracks  TrackGenre[]
}
```

- [ ] **Step 3: Add the `TrackGenre` model**

Add near the other genre join models (`ArtistGenre`, `AlbumGenre`):

```prisma
model TrackGenre {
  trackId String
  genreId String
  track   Track  @relation(fields: [trackId], references: [id], onDelete: Cascade)
  genre   Genre  @relation(fields: [genreId], references: [id])

  @@id([trackId, genreId])
  @@index([genreId])
}
```

- [ ] **Step 4: Create and apply the migration**

Run: `pnpm db:migrate --name track_genre`
Expected: a new migration under `prisma/migrations/…track_genre/` is created and applied; the Prisma client regenerates without error.

- [ ] **Step 5: Verify schema + types**

Run: `pnpm exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀".
Run: `pnpm exec tsc --noEmit`
Expected: no errors (confirms `db.trackGenre` is typed).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(genres): add TrackGenre model + migration"
```

---

## Task 2: Genre name helpers + server actions

**Files:**
- Create: `src/lib/genre.ts`
- Create: `src/server/actions/genres.ts`
- Test: `tests/lib/genre.test.ts`, `tests/server/genres.test.ts`

**Interfaces:**
- Consumes: `db` from `@/server/db`; `resolveTrackCoverHash` from `@/lib/cover-url`; Prisma models from Task 1.
- Produces:
  - `normalizeGenre(raw: string): string` and `displayGenre(name: string): string` (in `@/lib/genre`).
  - `GenreSummary { id: string; name: string; trackCount: number }`.
  - `GenreTrackSummary { id: string; title: string; duration: number; artist: string; album: string; coverArtHash: string | null; ytVideoId: string | null }`.
  - `getAllGenres(): Promise<GenreSummary[]>`
  - `getTracksByGenre(genreId: string): Promise<{ genre: GenreSummary | null; tracks: GenreTrackSummary[] }>`
  - `getGenresForTrack(trackId: string): Promise<GenreSummary[]>`
  - `addGenreToTrack(trackId: string, rawName: string): Promise<GenreSummary | null>`
  - `removeGenreFromTrack(trackId: string, genreId: string): Promise<void>`

- [ ] **Step 1: Write the failing test for the helpers**

Create `tests/lib/genre.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeGenre, displayGenre } from "@/lib/genre";

describe("genre helpers", () => {
  it("normalizeGenre trims, collapses whitespace, lowercases", () => {
    expect(normalizeGenre("  Indie   Rock ")).toBe("indie rock");
    expect(normalizeGenre("POP")).toBe("pop");
  });

  it("normalizeGenre returns empty string for blank input", () => {
    expect(normalizeGenre("   ")).toBe("");
  });

  it("displayGenre title-cases each word", () => {
    expect(displayGenre("indie rock")).toBe("Indie Rock");
    expect(displayGenre("r&b")).toBe("R&b");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/lib/genre.test.ts`
Expected: FAIL — cannot find module `@/lib/genre`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/genre.ts`:

```ts
/** Canonical stored form: trimmed, internal whitespace collapsed, lowercased.
    Genre.name is @unique, so this is what dedupes "Indie  Rock" and "indie rock". */
export function normalizeGenre(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Presentation form for the UI: title-case each word. Stored names are
    lowercase; capitalize only when rendering. */
export function displayGenre(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 4: Run the helper test — green**

Run: `pnpm exec vitest run tests/lib/genre.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the actions (DB-guarded)**

Create `tests/server/genres.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("genre actions", () => {
  let trackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "GenTest" },
      create: { name: "GenTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "GenAlbum" } },
      create: { title: "GenAlbum", artistId: artist.id },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 2; i++) {
      const t = await db.track.create({
        data: {
          title: `GenTrack ${i}`,
          duration: 100,
          filePath: `/tmp/gentest-${Date.now()}-${i}.m4a`,
          sha256: `gentest-${Date.now()}-${Math.random()}-${i}`,
          primaryArtistId: artist.id,
          albumId: album.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.trackGenre.deleteMany({ where: { trackId: { in: trackIds } } });
    await db.track.deleteMany({ where: { id: { in: trackIds } } });
    await db.album.deleteMany({ where: { title: "GenAlbum" } });
    await db.artist.deleteMany({ where: { name: "GenTest" } });
    await db.genre.deleteMany({ where: { name: { in: ["indie rock", "pop"] } } });
  });

  it("addGenreToTrack normalizes, dedupes, and is idempotent", async () => {
    const { addGenreToTrack, getGenresForTrack } = await import("@/server/actions/genres");
    await addGenreToTrack(trackIds[0]!, "Indie  Rock");
    await addGenreToTrack(trackIds[0]!, "indie rock"); // same after normalize
    const genres = await getGenresForTrack(trackIds[0]!);
    expect(genres.map((g) => g.name)).toEqual(["indie rock"]);
  });

  it("getAllGenres reports per-genre track counts", async () => {
    const { addGenreToTrack, getAllGenres } = await import("@/server/actions/genres");
    await addGenreToTrack(trackIds[0]!, "pop");
    await addGenreToTrack(trackIds[1]!, "pop");
    const all = await getAllGenres();
    const pop = all.find((g) => g.name === "pop");
    expect(pop?.trackCount).toBe(2);
  });

  it("getTracksByGenre returns playable tracks for the genre", async () => {
    const { addGenreToTrack, getTracksByGenre } = await import("@/server/actions/genres");
    await addGenreToTrack(trackIds[0]!, "pop");
    const genreId = (await import("@/server/db")).db.genre
      .findUnique({ where: { name: "pop" }, select: { id: true } });
    const { id } = (await genreId)!;
    const res = await getTracksByGenre(id);
    expect(res.genre?.name).toBe("pop");
    expect(res.tracks.map((t) => t.id)).toContain(trackIds[0]);
  });

  it("removeGenreFromTrack drops the link and garbage-collects the empty genre", async () => {
    const { addGenreToTrack, removeGenreFromTrack, getGenresForTrack } = await import(
      "@/server/actions/genres"
    );
    const added = await addGenreToTrack(trackIds[0]!, "pop");
    await removeGenreFromTrack(trackIds[0]!, added!.id);
    expect(await getGenresForTrack(trackIds[0]!)).toEqual([]);
    const { db } = await import("@/server/db");
    expect(await db.genre.findUnique({ where: { name: "pop" } })).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm exec vitest run tests/server/genres.test.ts`
Expected: FAIL — cannot find module `@/server/actions/genres` (or, if `DATABASE_URL` unset, the suite is skipped — set it to run these).

- [ ] **Step 7: Implement the actions**

Create `src/server/actions/genres.ts` (mirrors `src/server/actions/tags.ts`):

```ts
"use server";

import { db } from "@/server/db";
import { resolveTrackCoverHash } from "@/lib/cover-url";
import { normalizeGenre } from "@/lib/genre";

export interface GenreSummary {
  id: string;
  name: string;
  trackCount: number;
}

export interface GenreTrackSummary {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtHash: string | null;
  ytVideoId: string | null;
}

export async function getAllGenres(): Promise<GenreSummary[]> {
  const genres = await db.genre.findMany({
    select: { id: true, name: true, _count: { select: { tracks: true } } },
    orderBy: { name: "asc" },
  });
  return genres
    .map((g) => ({ id: g.id, name: g.name, trackCount: g._count.tracks }))
    .filter((g) => g.trackCount > 0);
}

export async function getGenresForTrack(trackId: string): Promise<GenreSummary[]> {
  const rows = await db.trackGenre.findMany({
    where: { trackId },
    select: { genre: { select: { id: true, name: true } } },
    orderBy: { genre: { name: "asc" } },
  });
  return rows.map((r) => ({ id: r.genre.id, name: r.genre.name, trackCount: 0 }));
}

export async function addGenreToTrack(
  trackId: string,
  rawName: string,
): Promise<GenreSummary | null> {
  const name = normalizeGenre(rawName);
  if (!name) return null;

  const genre = await db.genre.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true, name: true },
  });
  await db.trackGenre.upsert({
    where: { trackId_genreId: { trackId, genreId: genre.id } },
    create: { trackId, genreId: genre.id },
    update: {},
  });
  return { ...genre, trackCount: 0 };
}

export async function removeGenreFromTrack(trackId: string, genreId: string): Promise<void> {
  await db.trackGenre
    .delete({ where: { trackId_genreId: { trackId, genreId } } })
    .catch(() => {
      /* idempotent */
    });
  // Garbage-collect a genre that no longer labels any track, artist, or album,
  // so the browse grid never shows an empty genre. Mirrors tags.ts.
  const [tracks, artists, albums] = await Promise.all([
    db.trackGenre.count({ where: { genreId } }),
    db.artistGenre.count({ where: { genreId } }),
    db.albumGenre.count({ where: { genreId } }),
  ]);
  if (tracks === 0 && artists === 0 && albums === 0) {
    await db.genre.delete({ where: { id: genreId } }).catch(() => {});
  }
}

export async function getTracksByGenre(genreId: string): Promise<{
  genre: GenreSummary | null;
  tracks: GenreTrackSummary[];
}> {
  const genre = await db.genre.findUnique({
    where: { id: genreId },
    select: { id: true, name: true },
  });
  if (!genre) return { genre: null, tracks: [] };

  const rows = await db.trackGenre.findMany({
    where: { genreId },
    select: {
      track: {
        select: {
          id: true,
          title: true,
          duration: true,
          coverArtHash: true,
          ytVideoId: true,
          playable: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true, coverArtHash: true } },
        },
      },
    },
  });
  const tracks: GenreTrackSummary[] = rows
    .filter((r) => r.track.playable)
    .map((r) => ({
      id: r.track.id,
      title: r.track.title,
      duration: r.track.duration,
      artist: r.track.primaryArtist.name,
      album: r.track.album?.title ?? "",
      coverArtHash: resolveTrackCoverHash({
        trackCoverArtHash: r.track.coverArtHash,
        albumCoverArtHash: r.track.album?.coverArtHash,
      }),
      ytVideoId: r.track.ytVideoId ?? null,
    }));
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  return { genre: { ...genre, trackCount: tracks.length }, tracks };
}
```

- [ ] **Step 8: Run the action tests — green**

Run: `pnpm exec vitest run tests/server/genres.test.ts`
Expected: PASS (4 tests) when `DATABASE_URL` is set; SKIPPED otherwise.

- [ ] **Step 9: Commit**

```bash
git add src/lib/genre.ts src/server/actions/genres.ts tests/lib/genre.test.ts tests/server/genres.test.ts
git commit -m "feat(genres): genre name helpers + query/edit server actions"
```

---

## Task 3: Ollama service skeleton (`mood-llm.ts`) + env

**Files:**
- Modify: `src/lib/env.ts`, `.env.example`
- Create: `src/server/services/mood-llm.ts`
- Test: `tests/server/mood-llm.test.ts`

**Interfaces:**
- Consumes: `env` from `@/lib/env`.
- Produces:
  - `classifyGenre(input: { title: string; artist: string }): Promise<string[]>` — returns 0–3 lowercase genre names, `[]` on any failure.
  - `ollamaGenerateJson<T>(prompt: string): Promise<T | null>` — POSTs to `{OLLAMA_URL}/api/generate` with `format: "json"`, returns parsed JSON or `null` when Ollama is unreachable / returns junk.

- [ ] **Step 1: Add env vars**

In `src/lib/env.ts`, add to the `Schema` object (before `NODE_ENV`):

```ts
  // Local Ollama for genre/mood intelligence. Optional — when the server is
  // unreachable, features degrade gracefully rather than failing.
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("llama3.1:8b"),
```

- [ ] **Step 2: Document them in `.env.example`**

Append to `.env.example`:

```bash
# Local Ollama (optional) — powers genre/mood intelligence. Defaults shown.
# OLLAMA_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=llama3.1:8b
```

- [ ] **Step 3: Write the failing test**

Create `tests/server/mood-llm.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  process.env.OLLAMA_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "test-model";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mood-llm.classifyGenre", () => {
  it("parses a JSON genre array from Ollama's response envelope", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ genres: ["Pop", "Synth-pop"] }) }),
    } as never);

    const { classifyGenre } = await import("@/server/services/mood-llm");
    const genres = await classifyGenre({ title: "Blinding Lights", artist: "The Weeknd" });
    expect(genres).toEqual(["pop", "synth-pop"]);
  });

  it("sends the configured model to /api/generate", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ genres: [] }) }),
    } as never);

    const { classifyGenre } = await import("@/server/services/mood-llm");
    await classifyGenre({ title: "x", artist: "y" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:11434/api/generate");
    expect(JSON.parse((init as RequestInit).body as string).model).toBe("test-model");
  });

  it("returns [] when Ollama is unreachable (fetch throws)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { classifyGenre } = await import("@/server/services/mood-llm");
    expect(await classifyGenre({ title: "x", artist: "y" })).toEqual([]);
  });

  it("returns [] when the model emits non-JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: "sorry, I cannot help with that" }),
    } as never);
    const { classifyGenre } = await import("@/server/services/mood-llm");
    expect(await classifyGenre({ title: "x", artist: "y" })).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm exec vitest run tests/server/mood-llm.test.ts`
Expected: FAIL — cannot find module `@/server/services/mood-llm`.

- [ ] **Step 5: Implement the skeleton**

Create `src/server/services/mood-llm.ts`:

```ts
import { env } from "@/lib/env";
import { normalizeGenre } from "@/lib/genre";

const TIMEOUT_MS = 20_000;

/** POST a prompt to Ollama and parse the model's reply as JSON. Returns null on
    any failure — network, non-200, timeout, or a reply that isn't valid JSON —
    so callers can degrade gracefully. Ollama is never a hard dependency. */
export async function ollamaGenerateJson<T>(prompt: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    return JSON.parse(data.response) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cold-start genre guess from title + artist, for tracks MusicBrainz can't
    resolve (e.g. YouTube downloads). Returns 0–3 normalized genre names, or []
    when Ollama is unavailable or unsure. */
export async function classifyGenre(input: { title: string; artist: string }): Promise<string[]> {
  const prompt =
    `You label a song with music genres. Respond ONLY with JSON of the form ` +
    `{"genres": ["genre1", "genre2"]}. Use 1-3 common, broad genres (e.g. pop, ` +
    `rock, hip hop, r&b, jazz, electronic, indie, classical, country, k-pop). ` +
    `If unsure, return {"genres": []}.\n` +
    `Song: "${input.title}" by "${input.artist}".`;

  const parsed = await ollamaGenerateJson<{ genres?: unknown }>(prompt);
  if (!parsed || !Array.isArray(parsed.genres)) return [];
  const cleaned = parsed.genres
    .filter((g): g is string => typeof g === "string")
    .map((g) => normalizeGenre(g))
    .filter((g) => g.length > 0);
  return Array.from(new Set(cleaned)).slice(0, 3);
}
```

- [ ] **Step 6: Run the test — green**

Run: `pnpm exec vitest run tests/server/mood-llm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts .env.example src/server/services/mood-llm.ts tests/server/mood-llm.test.ts
git commit -m "feat(genres): Ollama service skeleton + config, with graceful fallback"
```

---

## Task 4: MusicBrainz genre fetch

**Files:**
- Modify: `src/server/services/musicbrainz.ts`
- Test: `tests/server/musicbrainz.test.ts` (add a describe block)

**Interfaces:**
- Consumes: existing `mbFetch` (module-private) + `queue` in `musicbrainz.ts`.
- Produces: `getGenres(entityType: "recording" | "artist" | "release", mbid: string): Promise<string[]>` — normalized genre names, most-used first, `[]` when MB has none.

- [ ] **Step 1: Write the failing test**

Add to `tests/server/musicbrainz.test.ts` inside the existing top-level `describe("musicbrainz service", …)` (or a new sibling describe):

```ts
  it("getGenres parses inc=genres and sorts by count desc", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        genres: [
          { name: "indie rock", count: 3 },
          { name: "Pop", count: 9 },
        ],
      }),
    } as never);

    const { getGenres } = await import("@/server/services/musicbrainz");
    const genres = await getGenres("recording", "abc-123");
    expect(genres).toEqual(["pop", "indie rock"]);
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/recording/abc-123");
    expect(String(url)).toContain("inc=genres");
  });

  it("getGenres returns [] when MB has no genres", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as never);
    const { getGenres } = await import("@/server/services/musicbrainz");
    expect(await getGenres("artist", "artist-mb-1")).toEqual([]);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/server/musicbrainz.test.ts`
Expected: FAIL — `getGenres` is not exported.

- [ ] **Step 3: Implement `getGenres`**

Add to `src/server/services/musicbrainz.ts` (after `getArtist`), reusing the module's `queue`, `mbFetch`, and importing the normalizer at the top:

```ts
// add to the imports at the top of the file:
// import { normalizeGenre } from "@/lib/genre";

export async function getGenres(
  entityType: "recording" | "artist" | "release",
  mbid: string,
): Promise<string[]> {
  return queue.add(async () => {
    const res = await mbFetch(`/${entityType}/${mbid}`, { inc: "genres" });
    const data = (await res.json()) as { genres?: { name: string; count?: number }[] };
    return (data.genres ?? [])
      .slice()
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .map((g) => normalizeGenre(g.name))
      .filter((g) => g.length > 0);
  }) as Promise<string[]>;
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm exec vitest run tests/server/musicbrainz.test.ts`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/musicbrainz.ts tests/server/musicbrainz.test.ts
git commit -m "feat(genres): fetch genres from MusicBrainz (inc=genres)"
```

---

## Task 5: Genre-tagger orchestrator

**Files:**
- Create: `src/server/services/genre-tagger.ts`
- Test: `tests/server/genre-tagger.test.ts`

**Interfaces:**
- Consumes: `db`; `getGenres` (Task 4); `classifyGenre` (Task 3); `normalizeGenre` (Task 2).
- Produces: `tagTrackGenres(trackId: string, deps?: GenreTaggerDeps): Promise<string[]>` — resolves genres for a track (MusicBrainz first, Ollama fallback), writes `Genre` + `TrackGenre` (and `ArtistGenre` when the source is the artist), returns the normalized names applied. `GenreTaggerDeps = { fetchMbGenres?: (entityType: "recording" | "artist", mbid: string) => Promise<string[]>; classifyGenre?: (input: { title: string; artist: string }) => Promise<string[]> }`. Deps are injectable so tests need no module mocking.

Design notes:
- Skip work if the track already has genres (idempotent, cheap to re-run in backfill).
- Order: recording MBID genres → artist MBID genres → Ollama fallback. Cap at 3.
- Only write `ArtistGenre` when genres came from the **artist** MBID (that's the only case they're truly artist-level).

- [ ] **Step 1: Write the failing test (DB-guarded, stubbed deps)**

Create `tests/server/genre-tagger.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("tagTrackGenres", () => {
  let trackId = "";
  let artistId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "TaggerTest" },
      create: { name: "TaggerTest", mbid: "artist-mbid-tagger" },
      update: { mbid: "artist-mbid-tagger" },
    });
    artistId = artist.id;
    const t = await db.track.create({
      data: {
        title: "Tagger Song",
        duration: 100,
        filePath: `/tmp/tagger-${Date.now()}.m4a`,
        sha256: `tagger-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        mbid: `rec-mbid-${Date.now()}`,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.trackGenre.deleteMany({ where: { trackId } });
    await db.artistGenre.deleteMany({ where: { artistId } });
    await db.track.deleteMany({ where: { id: trackId } });
    await db.artist.deleteMany({ where: { id: artistId } });
    await db.genre.deleteMany({ where: { name: { in: ["pop", "dream pop", "bedroom pop"] } } });
  });

  it("uses recording genres from MusicBrainz when available", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const applied = await tagTrackGenres(trackId, {
      fetchMbGenres: vi.fn(async (entity) => (entity === "recording" ? ["pop", "dream pop"] : [])),
      classifyGenre: vi.fn(async () => ["should-not-be-used"]),
    });
    expect(applied).toEqual(["pop", "dream pop"]);
    const { db } = await import("@/server/db");
    const rows = await db.trackGenre.findMany({
      where: { trackId },
      select: { genre: { select: { name: true } } },
    });
    expect(rows.map((r) => r.genre.name).sort()).toEqual(["dream pop", "pop"]);
  });

  it("falls back to Ollama when MusicBrainz has none", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const classify = vi.fn(async () => ["bedroom pop"]);
    const applied = await tagTrackGenres(trackId, {
      fetchMbGenres: vi.fn(async () => []),
      classifyGenre: classify,
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(applied).toEqual(["bedroom pop"]);
  });

  it("writes ArtistGenre when genres come from the artist MBID", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    await tagTrackGenres(trackId, {
      // recording empty, artist has genres → those are artist-level
      fetchMbGenres: vi.fn(async (entity) => (entity === "artist" ? ["pop"] : [])),
      classifyGenre: vi.fn(async () => []),
    });
    const { db } = await import("@/server/db");
    const ag = await db.artistGenre.findMany({ where: { artistId } });
    expect(ag.length).toBe(1);
  });

  it("is idempotent — a second run adds nothing", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const deps = {
      fetchMbGenres: vi.fn(async (entity: "recording" | "artist") =>
        entity === "recording" ? ["pop"] : [],
      ),
      classifyGenre: vi.fn(async () => []),
    };
    await tagTrackGenres(trackId, deps);
    const second = await tagTrackGenres(trackId, deps);
    expect(second).toEqual([]); // already tagged → no-op
    const { db } = await import("@/server/db");
    expect(await db.trackGenre.count({ where: { trackId } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/server/genre-tagger.test.ts`
Expected: FAIL — cannot find module `@/server/services/genre-tagger`.

- [ ] **Step 3: Implement the tagger**

Create `src/server/services/genre-tagger.ts`:

```ts
import { db } from "@/server/db";
import { getGenres } from "@/server/services/musicbrainz";
import { classifyGenre as ollamaClassifyGenre } from "@/server/services/mood-llm";

const MAX_GENRES = 3;

export interface GenreTaggerDeps {
  fetchMbGenres?: (entityType: "recording" | "artist", mbid: string) => Promise<string[]>;
  classifyGenre?: (input: { title: string; artist: string }) => Promise<string[]>;
}

/** Resolve and persist genres for one track. MusicBrainz first (recording, then
    artist), Ollama as cold-start fallback. Idempotent: a track that already has
    genres is left alone. Returns the normalized genre names applied this run
    ([] when nothing was added). Never throws MB/Ollama failures to the caller. */
export async function tagTrackGenres(
  trackId: string,
  deps: GenreTaggerDeps = {},
): Promise<string[]> {
  const fetchMbGenres = deps.fetchMbGenres ?? getGenres;
  const classifyGenre = deps.classifyGenre ?? ollamaClassifyGenre;

  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      mbid: true,
      primaryArtistId: true,
      primaryArtist: { select: { id: true, name: true, mbid: true } },
      _count: { select: { genres: true } },
    },
  });
  if (!track) return [];
  if (track._count.genres > 0) return []; // already tagged

  let names: string[] = [];
  let fromArtist = false;

  // 1) recording-level MB genres
  if (track.mbid) {
    names = await safe(() => fetchMbGenres("recording", track.mbid!));
  }
  // 2) artist-level MB genres
  if (names.length === 0 && track.primaryArtist.mbid) {
    names = await safe(() => fetchMbGenres("artist", track.primaryArtist.mbid!));
    if (names.length > 0) fromArtist = true;
  }
  // 3) Ollama cold-start
  if (names.length === 0) {
    names = await safe(() =>
      classifyGenre({ title: track.title, artist: track.primaryArtist.name }),
    );
  }

  names = dedupe(names).slice(0, MAX_GENRES);
  if (names.length === 0) return [];

  for (const name of names) {
    const genre = await db.genre.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    });
    await db.trackGenre.upsert({
      where: { trackId_genreId: { trackId, genreId: genre.id } },
      create: { trackId, genreId: genre.id },
      update: {},
    });
    if (fromArtist) {
      await db.artistGenre.upsert({
        where: { artistId_genreId: { artistId: track.primaryArtistId, genreId: genre.id } },
        create: { artistId: track.primaryArtistId, genreId: genre.id },
        update: {},
      });
    }
  }
  return names;
}

async function safe(fn: () => Promise<string[]>): Promise<string[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.filter((x) => x.length > 0)));
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm exec vitest run tests/server/genre-tagger.test.ts`
Expected: PASS (4 tests) when `DATABASE_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/genre-tagger.ts tests/server/genre-tagger.test.ts
git commit -m "feat(genres): genre-tagger orchestrator (MB first, Ollama fallback)"
```

---

## Task 6: Population wiring — metadata worker hook + backfill script

**Files:**
- Modify: `src/server/services/metadata-worker.ts`
- Create: `scripts/backfill-genres.ts`
- Test: `tests/server/backfill-genres.test.ts`

**Interfaces:**
- Consumes: `tagTrackGenres` (Task 5); `db`.
- Produces: `backfillGenres(opts?: { limit?: number; onProgress?: (done: number, total: number) => void }): Promise<{ tagged: number; scanned: number }>` (in `scripts/backfill-genres.ts`), plus a CLI entry when run directly.

- [ ] **Step 1: Hook the metadata worker**

In `src/server/services/metadata-worker.ts`, import the tagger at the top:

```ts
import { tagTrackGenres } from "@/server/services/genre-tagger";
```

Then, at the very end of `processTrackJob` (after the album/cover block, before the function returns), add:

```ts
  // Populate genres from the freshly-resolved MBIDs (MB first, Ollama fallback).
  // Best-effort: a genre failure must not fail the enrichment job.
  try {
    await tagTrackGenres(trackId);
  } catch (err) {
    console.warn("[mu] genre tagging failed:", err);
  }
```

- [ ] **Step 2: Write the failing test for the backfill helper (DB-guarded)**

Create `tests/server/backfill-genres.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("backfillGenres", () => {
  let trackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "BackfillTest" },
      create: { name: "BackfillTest" },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 2; i++) {
      const t = await db.track.create({
        data: {
          title: `Backfill ${i}`,
          duration: 100,
          filePath: `/tmp/backfill-${Date.now()}-${i}.m4a`,
          sha256: `backfill-${Date.now()}-${Math.random()}-${i}`,
          primaryArtistId: artist.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.trackGenre.deleteMany({ where: { trackId: { in: trackIds } } });
    await db.track.deleteMany({ where: { id: { in: trackIds } } });
    await db.artist.deleteMany({ where: { name: "BackfillTest" } });
    await db.genre.deleteMany({ where: { name: "test-genre" } });
  });

  it("tags every ungenred track via the injected tagger", async () => {
    const { backfillGenres } = await import("../../scripts/backfill-genres");
    const tagger = vi.fn(async (trackId: string) => {
      const { db } = await import("@/server/db");
      const g = await db.genre.upsert({
        where: { name: "test-genre" },
        create: { name: "test-genre" },
        update: {},
        select: { id: true },
      });
      await db.trackGenre.create({ data: { trackId, genreId: g.id } });
      return ["test-genre"];
    });
    const res = await backfillGenres({ tagger });
    expect(res.tagged).toBeGreaterThanOrEqual(2);
    const { db } = await import("@/server/db");
    for (const id of trackIds) {
      expect(await db.trackGenre.count({ where: { trackId: id } })).toBe(1);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run tests/server/backfill-genres.test.ts`
Expected: FAIL — cannot find module `../../scripts/backfill-genres`.

- [ ] **Step 4: Implement the backfill script**

Create `scripts/backfill-genres.ts` (the tagger is injectable for the test; the CLI uses the real one):

```ts
import { db } from "@/server/db";
import { tagTrackGenres } from "@/server/services/genre-tagger";

interface BackfillOpts {
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  /** Injectable for tests; defaults to the real tagger. */
  tagger?: (trackId: string) => Promise<string[]>;
}

/** Populate genres for every track that has none yet. Sequential on purpose:
    the tagger hits MusicBrainz (rate-limited to 1 req/s) and Ollama, so
    parallelism buys nothing and risks throttling. */
export async function backfillGenres(
  opts: BackfillOpts = {},
): Promise<{ tagged: number; scanned: number }> {
  const tagger = opts.tagger ?? tagTrackGenres;
  const tracks = await db.track.findMany({
    where: { genres: { none: {} } },
    select: { id: true },
    take: opts.limit,
  });
  let tagged = 0;
  for (let i = 0; i < tracks.length; i++) {
    const applied = await tagger(tracks[i]!.id);
    if (applied.length > 0) tagged++;
    opts.onProgress?.(i + 1, tracks.length);
  }
  return { tagged, scanned: tracks.length };
}

// CLI entry: `pnpm exec tsx --env-file=.env scripts/backfill-genres.ts`
if (process.argv[1] && process.argv[1].endsWith("backfill-genres.ts")) {
  backfillGenres({
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`[genres] ${done}/${total}`);
    },
  })
    .then((r) => {
      console.log(`[genres] done — tagged ${r.tagged}/${r.scanned} tracks`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[genres] backfill failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 5: Run the test — green**

Run: `pnpm exec vitest run tests/server/backfill-genres.test.ts`
Expected: PASS (1 test) when `DATABASE_URL` is set.

- [ ] **Step 6: Typecheck the worker change**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/metadata-worker.ts scripts/backfill-genres.ts tests/server/backfill-genres.test.ts
git commit -m "feat(genres): populate on enrichment + backfill script for existing tracks"
```

---

## Task 7: Navigation state for the genre screens

**Files:**
- Modify: `src/stores/ipod-store.ts`
- Test: `tests/stores/ipod-store.test.ts` (add cases)

**Interfaces:**
- Produces: two new `ScreenState` variants — `{ name: "genreList" }` and `{ name: "genreDetail"; genreId: string }` — and a `screenKey` case `genreDetail:<genreId>`.

- [ ] **Step 1: Write the failing test**

Add to `tests/stores/ipod-store.test.ts`:

```ts
  it("screenKey encodes genreDetail with its id", async () => {
    const { screenKey } = await import("@/stores/ipod-store");
    expect(screenKey({ name: "genreDetail", genreId: "g1" })).toBe("genreDetail:g1");
    expect(screenKey({ name: "genreList" })).toBe("genreList");
  });
```

(Match the existing import style in that file — if it imports `screenKey` at the top statically, use that instead of a dynamic import.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/stores/ipod-store.test.ts`
Expected: FAIL — `genreDetail` not assignable to `ScreenState` / wrong key.

- [ ] **Step 3: Add the screen states**

In `src/stores/ipod-store.ts`, add to the `ScreenState` union (near the `tagList`/`tagDetail` entries):

```ts
  | { name: "genreList" }
  | { name: "genreDetail"; genreId: string }
```

And add a case in `screenKey`, beside `tagDetail`:

```ts
    case "genreDetail":
      return `genreDetail:${s.genreId}`;
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm exec vitest run tests/stores/ipod-store.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/stores/ipod-store.ts tests/stores/ipod-store.test.ts
git commit -m "feat(genres): navigation states for genre browse + detail"
```

---

## Task 8: Genres browse + detail pages, nav, icon

**Files:**
- Create: `src/components/pages/GenresPage.tsx`, `src/components/pages/GenreDetailPage.tsx`
- Modify: `src/components/icons.tsx`, `src/components/pages/MainContent.tsx`, `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `getAllGenres`, `getTracksByGenre`, `GenreSummary`, `GenreTrackSummary` (Task 2); `displayGenre` (Task 2); `useIpodStore` + new screens (Task 7); `_shared` exports (`PageHeader`, `PageLoading`, `SongRow`, `buildQueueTrack`); `usePlayerStore`; `PlayIcon`.
- Produces: `GenresPage`, `GenreDetailPage`, `GenreIcon`.

There is no meaningful unit test for these presentational components in this codebase's conventions (component tests here are reserved for logic-bearing components). Verify via typecheck + build + a manual smoke check.

- [ ] **Step 1: Add `GenreIcon`**

In `src/components/icons.tsx`, add (a four-square "categories" glyph, matching the `Icon` wrapper pattern):

```tsx
export function GenreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" />
    </Icon>
  );
}
```

- [ ] **Step 2: Create `GenresPage`** (mirrors `TagsPage`)

Create `src/components/pages/GenresPage.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getAllGenres, type GenreSummary } from "@/server/actions/genres";
import { displayGenre } from "@/lib/genre";
import { useIpodStore } from "@/stores/ipod-store";
import { PageHeader, PageLoading } from "./_shared";

export function GenresPage() {
  const [genres, setGenres] = useState<GenreSummary[] | null>(null);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getAllGenres().then((r) => {
      if (!cancelled) setGenres(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Genres" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {genres === null ? (
          <PageLoading message="Loading genres…" />
        ) : genres.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            No genres yet — they fill in as your library is enriched, or run the genre
            backfill.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => push({ name: "genreDetail", genreId: g.id })}
                className="group flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
              >
                <span>{displayGenre(g.name)}</span>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] tabular-nums text-zinc-400 group-hover:bg-sky-500/20 group-hover:text-sky-300">
                  {g.trackCount}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `GenreDetailPage`** (mirrors `TagDetailPage`)

Create `src/components/pages/GenreDetailPage.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  getTracksByGenre,
  type GenreTrackSummary,
  type GenreSummary,
} from "@/server/actions/genres";
import { displayGenre } from "@/lib/genre";
import { usePlayerStore } from "@/stores/player-store";
import { PageHeader, PageLoading, SongRow, buildQueueTrack } from "./_shared";
import { PlayIcon } from "@/components/icons";

interface Props {
  genreId: string;
}

export function GenreDetailPage({ genreId }: Props) {
  const [data, setData] = useState<{
    genre: GenreSummary | null;
    tracks: GenreTrackSummary[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getTracksByGenre(genreId).then((r) => {
      if (!cancelled) setData(r);
    });
    return () => {
      cancelled = true;
    };
  }, [genreId]);

  if (data === null) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Loading…" subtitle="Genre" />
        <PageLoading message="Loading tracks…" />
      </div>
    );
  }

  if (!data.genre) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Genre not found.
      </div>
    );
  }

  const queue = data.tracks.map((t) =>
    buildQueueTrack({
      id: t.id,
      title: t.title,
      duration: t.duration,
      artistName: t.artist,
      albumTitle: t.album,
      coverArtHash: t.coverArtHash,
      ytVideoId: t.ytVideoId,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={displayGenre(data.genre.name)}
        subtitle={`Genre · ${data.tracks.length} track${data.tracks.length === 1 ? "" : "s"}`}
        actions={
          <button
            type="button"
            onClick={() => queue.length > 0 && play(0)}
            disabled={queue.length === 0}
            className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:opacity-40"
          >
            <PlayIcon size={16} /> Play
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <p className="px-3 py-12 text-center text-sm text-zinc-500">
            No tracks in this genre (yet).
          </p>
        ) : (
          queue.map((t, i) => (
            <SongRow
              key={t.id}
              track={t}
              index={i}
              onPlay={play}
              onDeleted={(id) =>
                setData((prev) =>
                  prev ? { ...prev, tracks: prev.tracks.filter((x) => x.id !== id) } : prev,
                )
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Route the screens in `MainContent`**

In `src/components/pages/MainContent.tsx`, add imports beside the Tag imports:

```tsx
import { GenresPage } from "./GenresPage";
import { GenreDetailPage } from "./GenreDetailPage";
```

And add cases in the switch, beside `tagList`/`tagDetail`:

```tsx
    case "genreList":
      return <GenresPage />;
    case "genreDetail":
      return <GenreDetailPage genreId={current.genreId} />;
```

- [ ] **Step 5: Add the Sidebar nav item**

In `src/components/layout/Sidebar.tsx`, add `GenreIcon` to the icon import list, then add a `NavItem` after the **Albums** item (inside the Library group):

```tsx
      <NavItem
        label="Genres"
        icon={<GenreIcon size={18} />}
        target={{ name: "genreList" }}
        active={activeName === "genreList" || activeName === "genreDetail"}
      />
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Manual smoke check**

Start the dev server (via the preview tooling / `pnpm dev`), open the app, click **Genres** in the sidebar. Expect the genre grid (populated after a backfill run or once enrichment has run). Click a genre → the songs list renders and **Play** starts the queue. (If the library has no genres yet, run `pnpm exec tsx --env-file=.env scripts/backfill-genres.ts` first.)

- [ ] **Step 8: Commit**

```bash
git add src/components/icons.tsx src/components/pages/GenresPage.tsx src/components/pages/GenreDetailPage.tsx src/components/pages/MainContent.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(genres): browse + detail pages, sidebar nav, genre icon"
```

---

## Task 9: Manual genre editing UI (`GenreEditor`)

**Files:**
- Create: `src/components/genres/GenreEditor.tsx`
- Modify: `src/components/pages/NotesPage.tsx`

**Interfaces:**
- Consumes: `getGenresForTrack`, `addGenreToTrack`, `removeGenreFromTrack`, `GenreSummary` (Task 2); `displayGenre` (Task 2).
- Produces: `GenreEditor({ trackId }: { trackId: string })`.

Mirror `src/components/tags/TagEditor.tsx` — read its current implementation first and follow its structure (input to add, chips with a remove control, optimistic local state). The only differences: call the genre actions instead of the tag actions, and render names with `displayGenre`.

- [ ] **Step 1: Read the reference component**

Read `src/components/tags/TagEditor.tsx` in full to match its exact structure, class names, and interaction pattern.

- [ ] **Step 2: Create `GenreEditor`**

Create `src/components/genres/GenreEditor.tsx` as a `"use client"` component that mirrors `TagEditor` but uses:
- `getGenresForTrack(trackId)` on mount to load current genres,
- `addGenreToTrack(trackId, name)` on submit (append the returned `GenreSummary` to local state when non-null; ignore null/duplicates),
- `removeGenreFromTrack(trackId, genreId)` on chip removal (drop it from local state),
- `displayGenre(g.name)` for the chip label.

Keep the same wrapper/label styling as `TagEditor` so the two editors read as a pair (e.g. a "Genres" heading matching the "Tags" heading).

- [ ] **Step 3: Render it in `NotesPage`**

In `src/components/pages/NotesPage.tsx`, import it and render directly below the existing `<TagEditor trackId={trackId} />`:

```tsx
import { GenreEditor } from "@/components/genres/GenreEditor";
// …
          <TagEditor trackId={trackId} />
          <GenreEditor trackId={trackId} />
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Manual smoke check**

Open a song's Notes view. Add a genre → it appears as a chip and shows up in the Genres browse grid. Remove it → chip disappears; if it was the genre's last track, the genre drops from the grid.

- [ ] **Step 6: Commit**

```bash
git add src/components/genres/GenreEditor.tsx src/components/pages/NotesPage.tsx
git commit -m "feat(genres): manual per-track genre editor in Notes"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `pnpm test`
Expected: all pass (DB-guarded suites run when `DATABASE_URL` is set; otherwise skipped — run at least once with it set to exercise Tasks 2, 5, 6).

- [ ] **Backfill the real library**

Run: `pnpm exec tsx --env-file=.env scripts/backfill-genres.ts`
Expected: progress logs, then a summary. Genres now populate the browse grid.

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 1 scope):**
- "list songs by genre" → Tasks 2 (actions) + 8 (browse/detail pages). ✓
- `TrackGenre` model → Task 1. ✓
- Population: MusicBrainz → Task 4 + 5; Ollama fallback → Task 3 + 5; manual → Task 2 (actions) + 9 (UI). ✓
- Ollama service skeleton (de-risk early) → Task 3. ✓
- New-track population + existing-library backfill → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step contains real, runnable code. ✓

**Type consistency:** `GenreSummary` / `GenreTrackSummary` defined in Task 2 and consumed unchanged in Tasks 8/9. `tagTrackGenres(trackId, deps?)` signature is consistent across Tasks 5 and 6. `getGenres(entityType, mbid)` consistent across Tasks 4 and 5. `classifyGenre({title, artist})` consistent across Tasks 3 and 5. Screen states `genreList`/`genreDetail` defined in Task 7 and used in Task 8. ✓
