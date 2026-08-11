# YouTube Playlist/Mix Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user preview and prune a YouTube playlist/mix before anything downloads, watch download progress in a dedicated tab, and optionally supply per-user YouTube cookies for real personalization.

**Architecture:** Split the current one-shot `POST /api/yt-playlist` into a read-only *preview* and a side-effecting *enqueue*. Preview classifies the URL (mix vs playlist), bounds mixes with `--playlist-end`, and dedupes. A new picker screen drives selection; enqueue creates rows and runs the existing sequential download chain without touching the play queue. A Downloads screen reads `YtCacheEntry` from the server so progress survives reload.

**Tech Stack:** Next.js App Router, React 19, Zustand, Prisma/Postgres, vitest, yt-dlp.

## Global Constraints

- Mixes (`RD`, `RDMM`, `RDAMVM`, `RDEM` list-id prefixes) get `--playlist-end 40` and videoId dedupe. Playlists (everything else) get neither.
- Default checked count: 20 for mixes, all for playlists.
- Downloads tab retention: 24 hours.
- Enqueue must never mutate the play queue.
- Cookie jars must live outside `MUSIC_LIBRARY_PATH` and outside Postgres — `scripts/backup.sh` mirrors both offsite.
- Cookie file contents and yt-dlp stderr containing them must never be logged or persisted to `errorMessage`.
- Existing `download-store.ts` and `DownloadIndicator.tsx` are NOT modified.

---

## File Structure

**Create:**
- `src/server/services/yt-list.ts` — URL classification + preview. Pure-ish, no DB.
- `src/server/services/yt-cookies.ts` — cookie jar path resolution, Netscape validation, staleness.
- `src/app/api/yt-playlist/preview/route.ts`
- `src/app/api/yt-playlist/enqueue/route.ts`
- `src/app/api/downloads/route.ts`
- `src/app/api/downloads/[videoId]/retry/route.ts`
- `src/app/api/yt-cookies/route.ts`
- `src/components/pages/YtPlaylistPickerPage.tsx`
- `src/components/pages/DownloadsPage.tsx`
- `tests/server/yt-list.test.ts`
- `tests/server/yt-cookies.test.ts`

**Modify:**
- `src/server/services/yt-service.ts` — `runYtDlp` cookie arg, `fetchPlaylist` options.
- `src/server/services/yt-download.ts` — `enqueueSelected`, `listDownloads`, `retryDownload`; drop `enqueuePlaylist`.
- `src/stores/ipod-store.ts` — two new screen states.
- `src/components/pages/MainContent.tsx` — two new routes.
- `src/components/layout/Sidebar.tsx` — Downloads nav item.
- `src/components/pages/SearchPage.tsx` — collapse card to "Review N songs".
- `src/components/pages/SettingsPage.tsx` — Connect YouTube section.
- `src/lib/env.ts` — `YT_COOKIES_DIR`.
- `src/components/icons.tsx` — DownloadIcon if absent.

**Delete:**
- `src/app/api/yt-playlist/route.ts`

---

## Phase 1 — Fetch layer and picker

### Task 1: List classification and bounded fetch

**Files:**
- Create: `src/server/services/yt-list.ts`
- Modify: `src/server/services/yt-service.ts`
- Test: `tests/server/yt-list.test.ts`

**Interfaces:**
- Produces: `classifyListUrl(url: string): { kind: "mix" | "playlist"; listId: string } | null`
- Produces: `previewList(url: string, cookiePath?: string | null): Promise<ListPreview>` where
  `ListPreview = { kind: "mix" | "playlist"; listId: string; title: string; tracks: YtSearchResult[]; defaultCheckedCount: number }`
- Consumes: `fetchPlaylist(url, opts?: { playlistEnd?: number; cookiePath?: string | null })` from `yt-service.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/yt-list.test.ts — classification block
it("classifies RD/RDMM/RDAMVM/RDEM as mix", async () => {
  const { classifyListUrl } = await import("@/server/services/yt-list");
  for (const id of ["RDabc", "RDMMabc", "RDAMVMabc", "RDEMabc"]) {
    expect(classifyListUrl(`https://www.youtube.com/watch?v=x&list=${id}`))
      .toEqual({ kind: "mix", listId: id });
  }
});

it("classifies PL/OLAK5uy_/UU as playlist", async () => {
  const { classifyListUrl } = await import("@/server/services/yt-list");
  for (const id of ["PLabc", "OLAK5uy_abc", "UUabc"]) {
    expect(classifyListUrl(`https://www.youtube.com/playlist?list=${id}`)?.kind)
      .toBe("playlist");
  }
});

it("returns null when there is no list param or the URL is junk", async () => {
  const { classifyListUrl } = await import("@/server/services/yt-list");
  expect(classifyListUrl("https://www.youtube.com/watch?v=x")).toBeNull();
  expect(classifyListUrl("not a url")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/server/yt-list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `classifyListUrl`**

Mix prefixes checked longest-first so `RDMM` doesn't match bare `RD` semantics ambiguously; all four are mixes anyway, so a single `/^RD/` test suffices, but keep the explicit list for readability.

- [ ] **Step 4: Add fetch-shape tests**

```ts
it("passes --playlist-end for mixes and omits it for playlists", async () => {
  // spawn mocked as in tests/server/yt-service.test.ts; assert on args array
});

it("dedupes mix entries by videoId preserving first occurrence", async () => {
  // feed entries [a,b,a,c]; expect [a,b,c]
});

it("does not dedupe playlist entries", async () => {
  // a real playlist legitimately may repeat a track
});

it("caps defaultCheckedCount at 20 for mixes and all for playlists", async () => {});
```

- [ ] **Step 5: Implement `fetchPlaylist` options + `previewList`**

`fetchPlaylist(url, opts)` appends `--playlist-end ${opts.playlistEnd}` when set and `--cookies ${opts.cookiePath}` when set. `previewList` classifies, calls fetch with `playlistEnd: 40` for mixes, dedupes mixes only, computes `defaultCheckedCount`.

- [ ] **Step 6: Run tests, expect PASS. Commit.**

```bash
git add src/server/services/yt-list.ts src/server/services/yt-service.ts tests/server/yt-list.test.ts
git commit -m "feat(yt): classify mix vs playlist, bound mixes with --playlist-end, dedupe"
```

### Task 2: Preview and enqueue routes

**Files:**
- Create: `src/app/api/yt-playlist/preview/route.ts`, `src/app/api/yt-playlist/enqueue/route.ts`
- Modify: `src/server/services/yt-download.ts`
- Delete: `src/app/api/yt-playlist/route.ts`
- Test: `tests/server/yt-list.test.ts` (no-DB-writes regression)

**Interfaces:**
- Produces: `enqueueSelected(videos: YtSearchResult[]): Promise<{ trackIds: string[] }>` — creates rows via existing `createPendingDownload`, fires `runPlaylistDownloadChain`, returns. Never touches the queue.
- Removes: `enqueuePlaylist`.

- [ ] **Step 1: Write the regression test**

```ts
it("previewList performs no database writes", async () => {
  const dbMock = { track: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
                   ytCacheEntry: { upsert: vi.fn() } };
  vi.doMock("@/server/db", () => ({ db: dbMock }));
  // ...run previewList against a mocked spawn...
  expect(dbMock.track.create).not.toHaveBeenCalled();
  expect(dbMock.ytCacheEntry.upsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement both routes and `enqueueSelected`; delete the old route and `enqueuePlaylist`.**
- [ ] **Step 4: Run full suite, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git commit -am "feat(yt): split playlist API into read-only preview and enqueue"
```

### Task 3: Picker screen and SearchPage rewire

**Files:**
- Create: `src/components/pages/YtPlaylistPickerPage.tsx`
- Modify: `src/stores/ipod-store.ts`, `src/components/pages/MainContent.tsx`, `src/components/pages/SearchPage.tsx`
- Test: `tests/stores/ipod-store.test.ts` (screenKey for the new route)

**Interfaces:**
- Consumes: `POST /api/yt-playlist/preview` → `ListPreview`; `POST /api/yt-playlist/enqueue`.
- Produces: screen state `{ name: "ytPlaylistPicker"; url: string }`, keyed as `ytPlaylistPicker:${url}`.

- [ ] **Step 1: Add the screen state + `screenKey` case; test it.**
- [ ] **Step 2: Build the picker.** Checkbox rows (thumbnail, title, uploader, duration), select all/none, drift divider after index 20 for mixes only, sticky "Download N songs" footer, error and empty states.
- [ ] **Step 3: Rewire SearchPage** — one "Review N songs" button that pushes the picker. Remove the two old buttons and the "paste again for more" toast.
- [ ] **Step 4: Run tests + lint. Commit.**

---

## Phase 2 — Downloads tab

### Task 4: Downloads API

**Files:**
- Create: `src/app/api/downloads/route.ts`, `src/app/api/downloads/[videoId]/retry/route.ts`
- Modify: `src/server/services/yt-download.ts`

**Interfaces:**
- Produces: `listDownloads(): Promise<DownloadRow[]>` where
  `DownloadRow = { ytVideoId, trackId, title, artist, status, progressPct, errorMessage, completedAt, ytVideoIdForCover }`.
  Includes everything `DOWNLOADING` or `FAILED`, plus `READY` with `completedAt` within 24h. Sorted active-first, then most recent.
- Produces: `retryDownload(ytVideoId: string): Promise<void>` — re-runs `runDownloadJob` for a FAILED entry.

- [ ] **Step 1: Test `listDownloads` filter + ordering against a mocked db.**
- [ ] **Step 2: Implement, run, commit.**

### Task 5: Downloads screen

**Files:**
- Create: `src/components/pages/DownloadsPage.tsx`
- Modify: `src/stores/ipod-store.ts`, `src/components/pages/MainContent.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/icons.tsx`

- [ ] **Step 1: Add `{ name: "downloads" }` screen state and route.**
- [ ] **Step 2: Build the page** — polls `GET /api/downloads` every 1000ms only while at least one row is `DOWNLOADING`; sections Active / Failed / Completed (24h); per-row "Add to queue" using `addToQueue`, plus "Add all to queue" using `addManyToQueue`; retry button on failures.
- [ ] **Step 3: Sidebar nav item with an active-count badge.**
- [ ] **Step 4: Run tests + lint. Commit.**

---

## Phase 3 — Per-user cookies

### Task 6: Cookie storage and validation

**Files:**
- Create: `src/server/services/yt-cookies.ts`, `src/app/api/yt-cookies/route.ts`
- Modify: `src/lib/env.ts`, `.env.example`, `.gitignore`
- Test: `tests/server/yt-cookies.test.ts`

**Interfaces:**
- Produces: `validateNetscapeCookies(text: string): { ok: true } | { ok: false; reason: string }` — requires the Netscape header line and at least one `.youtube.com` session cookie from the expected set.
- Produces: `cookiePathFor(name: AppUserName): string`, `readCookiePath(name): Promise<string | null>`, `saveCookies(name, text): Promise<void>` (mode `600`), `markStale(name): Promise<void>`, `isStaleError(stderr: string): boolean`.
- Produces: `scrubCookiePaths(message: string): string` — strips any `--cookies <path>` occurrence before logging.

- [ ] **Step 1: Tests** — validator accepts a well-formed jar, rejects HTML/empty/missing-session-cookie; `cookiePathFor` never resolves inside `MUSIC_LIBRARY_PATH`; `scrubCookiePaths` removes paths.
- [ ] **Step 2: Implement. Add `YT_COOKIES_DIR` to env schema with a default outside the library.**
- [ ] **Step 3: Run, commit.**

### Task 7: Wire cookies through yt-dlp and Settings

**Files:**
- Modify: `src/server/services/yt-service.ts`, `src/server/services/yt-list.ts`, `src/components/pages/SettingsPage.tsx`

- [ ] **Step 1: Preview route resolves the caller's jar from `mu_name` and passes `cookiePath`.**
- [ ] **Step 2: Settings "Connect YouTube" — upload, status (connected / stale / none), remove.**
- [ ] **Step 3: Stale detection** — on yt-dlp failure matching `isStaleError`, mark stale and surface "Reconnect" in Settings; the fetch itself falls back to anonymous rather than hard-failing.
- [ ] **Step 4: Run full verification. Commit.**

---

## Verification

- [ ] `pnpm vitest run` — all pass
- [ ] `pnpm lint` — clean
- [ ] `npx tsc --noEmit` — clean
- [ ] `pnpm build` — succeeds

## Self-review notes

Spec coverage checked section by section: root-cause fixes (Task 1), API split (Task 2), picker (Task 3), Downloads tab (Tasks 4–5), cookies (Tasks 6–7), security posture (Task 6 constraints), error handling (Tasks 2, 5, 7), testing (each task). No section unmapped.
