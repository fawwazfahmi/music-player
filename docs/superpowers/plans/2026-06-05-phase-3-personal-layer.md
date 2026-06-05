# Music Universe — Phase 3: Personal Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make the iPod yours. Favorites (heart any track), Playlists (create + add + reorder), Notes (write memories on songs), per-screen selection memory (returning to a screen restores your last cursor position), Settings (Rescan Library + Logout), and auto-starting the file watcher on app boot.

**Architecture:**
- Server actions for CRUD on `FavoriteTrack/Album/Artist`, `Playlist`/`PlaylistTrack`, `SongNote` — schema is already in place from Phase 0.
- Per-screen selection memory lives in `ipod-store` as a `Map<screenKey, number>` keyed by stable screen identity (e.g. `home`, `musicSub`, `artistList`, `playlistDetail:abc123`).
- Settings is a new screen accessible from HomeMenu.
- Inline text input on the iPod screen for note editing + playlist naming (same pattern as Search input).
- File watcher auto-starts via Next.js 16 `instrumentation.ts` hook.

**Tech Stack:** No new deps. Uses existing Prisma + Zustand + custom event bus.

**Reference:** Spec §3 (entities), §6 (server actions), §7 Phase 3.

---

## Prerequisites

- Phase 2 merged to `main` (commits up through `9982c27` then perf fixes through `5781994`).
- Dev server running on port 3000.
- DB has at least 2 playable tracks (Tate McRae + Laufey from earlier).
- Branch: create `phase-3-personal-layer` off `main`.

---

## File Structure (Phase 3 additions)

```
src/
├─ instrumentation.ts                                # CREATE — Next.js boot hook to start chokidar watcher
├─ stores/
│  └─ ipod-store.ts                                  # MODIFY — add per-screen selection memory + 3 new screen states
├─ components/ipod/
│  ├─ Ipod.tsx                                       # MODIFY — use per-screen memory; new screen wiring
│  ├─ Screen.tsx                                     # MODIFY — render new screens
│  ├─ screens/
│  │  ├─ HomeMenu.tsx                                # MODIFY — add "Settings"
│  │  ├─ MusicSub.tsx                                # MODIFY — add "Favorites" + "Playlists"
│  │  ├─ NowPlaying.tsx                              # MODIFY — show heart icon if favorited
│  │  ├─ Settings.tsx                                # CREATE
│  │  ├─ FavoritesList.tsx                           # CREATE
│  │  ├─ PlaylistList.tsx                            # CREATE
│  │  ├─ PlaylistDetail.tsx                          # CREATE
│  │  ├─ Notes.tsx                                   # CREATE
│  │  └─ TextInput.tsx                               # CREATE — shared inline-input primitive
├─ server/actions/
│  ├─ playlists.ts                                   # CREATE
│  ├─ favorites.ts                                   # CREATE
│  └─ memory.ts                                      # CREATE — song notes

tests/server/
├─ playlists.test.ts                                 # CRUD + reorder
├─ favorites.test.ts                                 # toggle
└─ memory.test.ts                                    # addNote / listNotes / delete
```

---

## Conventions

- Same as Phase 1/2. TDD strictly for server actions. Smoke-only for screens.
- All DB tests use the `tmp`-scoped delete pattern so they don't wipe real data.
- Per-screen selection memory uses a screen-key function: `screenKey(s: ScreenState) → string`. For `{name:"home"}` → `"home"`, for `{name:"playlistDetail",playlistId:"abc"}` → `"playlistDetail:abc"`. Stable across re-mounts.
- Inline `TextInput` is the same pattern as Search — focused on mount, captures keyboard, dispatches `ipod-select` on Enter (which the screen handles via its own listener).
- One task → one commit.

---

## Task 1: Per-screen selection memory (lift to ipod-store)

**Files:**
- Modify: `src/stores/ipod-store.ts`
- Modify: `src/components/ipod/Ipod.tsx`

### Step 1: Extend ipod-store

In `ipod-store.ts`, add a `selectionByScreen: Map<string, number>` (or plain object). Add helpers:
- `screenKey(s: ScreenState): string`
- `getSelectionFor(s: ScreenState): number`
- `setSelectionFor(s: ScreenState, idx: number): void`

```ts
export function screenKey(s: ScreenState): string {
  switch (s.name) {
    case "artistDetail": return `artistDetail:${s.artistId}`;
    case "albumDetail":  return `albumDetail:${s.albumId}`;
    case "ytPicker":     return `ytPicker:${s.query}`;
    default:             return s.name;
  }
}

interface IpodState {
  navStack: ScreenState[];
  selectionByScreen: Record<string, number>;
  current: () => ScreenState;
  push: (screen: ScreenState) => void;
  pop: () => void;
  toRoot: () => void;
  getSelectionFor: (s: ScreenState) => number;
  setSelectionFor: (s: ScreenState, idx: number) => void;
}

export const useIpodStore = create<IpodState>((set, get) => ({
  navStack: [{ name: "home" }],
  selectionByScreen: {},
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
  getSelectionFor: (s) => get().selectionByScreen[screenKey(s)] ?? 0,
  setSelectionFor: (s, idx) =>
    set((state) => ({
      selectionByScreen: { ...state.selectionByScreen, [screenKey(s)]: idx },
    })),
}));
```

### Step 2: Switch Ipod.tsx to use the store

Replace the local `useState(selected)` + `setLastScreenName` pattern with:

```ts
const selected = useIpodStore((s) => s.getSelectionFor(current));
const setSelected = (n: number | ((prev: number) => number)) => {
  const next = typeof n === "function" ? n(selected) : n;
  useIpodStore.getState().setSelectionFor(current, next);
};
```

And drop the `lastScreenName` state + the `if (lastScreenName !== current.name)` block. The store handles per-screen memory now.

### Step 3: Add tests for the new helpers

`tests/stores/ipod-store.test.ts` — add cases:
- `getSelectionFor` returns 0 for unseen screens
- `setSelectionFor` then `getSelectionFor` returns set value
- Different screens (e.g. `artistDetail:a` vs `artistDetail:b`) maintain separate values

### Step 4: Verify

```bash
pnpm test
pnpm exec tsc --noEmit
```

### Step 5: Commit

```bash
git add -A
git commit -m "feat(store): per-screen selection memory keyed by stable screen id"
```

---

## Task 2: Favorites server actions + tests

**Files:**
- Create: `src/server/actions/favorites.ts`
- Create: `tests/server/favorites.test.ts`

### Step 1: Failing tests

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("favorites actions", () => {
  let trackId: string;
  let artistId: string;
  let albumId: string;

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "FavTest" },
      create: { name: "FavTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "FavAlbum" } },
      create: { title: "FavAlbum", artistId: artist.id },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "FavTrack",
        duration: 100,
        filePath: `/tmp/fav-${Date.now()}.m4a`,
        sha256: `fav-sha-${Date.now()}`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
    artistId = artist.id;
    albumId = album.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.favoriteTrack.deleteMany({ where: { trackId } });
    await db.favoriteAlbum.deleteMany({ where: { albumId } });
    await db.favoriteArtist.deleteMany({ where: { artistId } });
    await db.track.deleteMany({ where: { id: trackId } });
    await db.album.deleteMany({ where: { id: albumId } });
    await db.artist.deleteMany({ where: { id: artistId } });
  });

  it("toggleFavorite(track) adds then removes", async () => {
    const { toggleFavorite, isFavorited } = await import("@/server/actions/favorites");
    expect(await isFavorited("TRACK", trackId)).toBe(false);
    expect(await toggleFavorite("TRACK", trackId)).toBe(true);
    expect(await isFavorited("TRACK", trackId)).toBe(true);
    expect(await toggleFavorite("TRACK", trackId)).toBe(false);
    expect(await isFavorited("TRACK", trackId)).toBe(false);
  });

  it("toggleFavorite works for artist + album", async () => {
    const { toggleFavorite } = await import("@/server/actions/favorites");
    expect(await toggleFavorite("ARTIST", artistId)).toBe(true);
    expect(await toggleFavorite("ALBUM", albumId)).toBe(true);
  });
});
```

### Step 2: Implement

`src/server/actions/favorites.ts`:

```ts
"use server";
import { db } from "@/server/db";

export type FavoriteKind = "TRACK" | "ALBUM" | "ARTIST";

export async function isFavorited(kind: FavoriteKind, id: string): Promise<boolean> {
  if (kind === "TRACK") return !!(await db.favoriteTrack.findUnique({ where: { trackId: id } }));
  if (kind === "ALBUM") return !!(await db.favoriteAlbum.findUnique({ where: { albumId: id } }));
  return !!(await db.favoriteArtist.findUnique({ where: { artistId: id } }));
}

export async function toggleFavorite(kind: FavoriteKind, id: string): Promise<boolean> {
  const currentlyFav = await isFavorited(kind, id);
  if (currentlyFav) {
    if (kind === "TRACK") await db.favoriteTrack.delete({ where: { trackId: id } });
    else if (kind === "ALBUM") await db.favoriteAlbum.delete({ where: { albumId: id } });
    else await db.favoriteArtist.delete({ where: { artistId: id } });
    return false;
  }
  if (kind === "TRACK") await db.favoriteTrack.create({ data: { trackId: id } });
  else if (kind === "ALBUM") await db.favoriteAlbum.create({ data: { albumId: id } });
  else await db.favoriteArtist.create({ data: { artistId: id } });
  return true;
}

export async function getFavoriteTracks() {
  return db.favoriteTrack.findMany({
    orderBy: { favoritedAt: "desc" },
    include: {
      track: {
        select: {
          id: true, title: true, duration: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true, coverArtPath: true } },
        },
      },
    },
  });
}
```

### Step 3: Verify

```bash
pnpm test
```

### Step 4: Commit

```bash
git add -A
git commit -m "feat(favorites): toggleFavorite + isFavorited + getFavoriteTracks"
```

---

## Task 3: Playlists server actions + tests

**Files:**
- Create: `src/server/actions/playlists.ts`
- Create: `tests/server/playlists.test.ts`

Operations: `createPlaylist(name)`, `renamePlaylist(id, name)`, `deletePlaylist(id)`, `addToPlaylist(playlistId, trackId)`, `removeFromPlaylist(playlistId, trackId)`, `reorderPlaylist(playlistId, trackIds[])`, `getPlaylists()`, `getPlaylistWithTracks(id)`.

### Step 1: Failing test

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("playlists actions", () => {
  let trackIds: string[] = [];
  let createdPlaylistIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({ where: { name: "PlTest" }, create: { name: "PlTest" }, update: {} });
    const album = await db.album.upsert({ where: { artistId_title: { artistId: artist.id, title: "PlAlbum" } }, create: { title: "PlAlbum", artistId: artist.id }, update: {} });
    trackIds = [];
    for (let i = 0; i < 3; i++) {
      const t = await db.track.create({
        data: {
          title: `PlTrack ${i}`, duration: 100,
          filePath: `/tmp/pltest-${Date.now()}-${i}.m4a`,
          sha256: `pltest-${Date.now()}-${i}`,
          primaryArtistId: artist.id, albumId: album.id, source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
    createdPlaylistIds = [];
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.playlist.deleteMany({ where: { id: { in: createdPlaylistIds } } });
    await db.track.deleteMany({ where: { id: { in: trackIds } } });
    await db.album.deleteMany({ where: { title: "PlAlbum" } });
    await db.artist.deleteMany({ where: { name: "PlTest" } });
  });

  it("create + add + reorder + delete", async () => {
    const { createPlaylist, addToPlaylist, reorderPlaylist, getPlaylistWithTracks, deletePlaylist } = await import("@/server/actions/playlists");
    const { id } = await createPlaylist("My Mix");
    createdPlaylistIds.push(id);

    for (const t of trackIds) await addToPlaylist(id, t);
    let pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.map((t) => t.id)).toEqual(trackIds);

    const reversed = [...trackIds].reverse();
    await reorderPlaylist(id, reversed);
    pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.map((t) => t.id)).toEqual(reversed);

    await deletePlaylist(id);
    pl = await getPlaylistWithTracks(id);
    expect(pl).toBeNull();
    createdPlaylistIds = [];
  });
});
```

### Step 2: Implement

`src/server/actions/playlists.ts`:

```ts
"use server";
import { db } from "@/server/db";

export async function getPlaylists() {
  return db.playlist.findMany({
    orderBy: { position: "asc" },
    select: {
      id: true, name: true, coverImagePath: true,
      _count: { select: { tracks: true } },
    },
  });
}

export async function getPlaylistWithTracks(id: string) {
  const pl = await db.playlist.findUnique({
    where: { id },
    select: {
      id: true, name: true,
      tracks: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          track: {
            select: {
              id: true, title: true, duration: true,
              primaryArtist: { select: { name: true } },
              album: { select: { title: true, coverArtPath: true } },
            },
          },
        },
      },
    },
  });
  if (!pl) return null;
  return { id: pl.id, name: pl.name, tracks: pl.tracks.map((t) => t.track) };
}

export async function createPlaylist(name: string): Promise<{ id: string }> {
  const count = await db.playlist.count();
  const pl = await db.playlist.create({
    data: { name, position: count },
    select: { id: true },
  });
  return pl;
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  await db.playlist.update({ where: { id }, data: { name } });
}

export async function deletePlaylist(id: string): Promise<void> {
  await db.playlist.delete({ where: { id } });
}

export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const existing = await db.playlistTrack.findUnique({
    where: { playlistId_trackId: { playlistId, trackId } },
  });
  if (existing) return;
  const last = await db.playlistTrack.findFirst({
    where: { playlistId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await db.playlistTrack.create({
    data: { playlistId, trackId, position: (last?.position ?? -1) + 1 },
  });
}

export async function removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  await db.playlistTrack.delete({ where: { playlistId_trackId: { playlistId, trackId } } });
}

export async function reorderPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
  await db.$transaction(
    trackIds.map((trackId, position) =>
      db.playlistTrack.update({
        where: { playlistId_trackId: { playlistId, trackId } },
        data: { position },
      }),
    ),
  );
}
```

### Step 3: Verify + Step 4: Commit

```bash
pnpm test
git add -A && git commit -m "feat(playlists): CRUD + add/remove/reorder server actions"
```

---

## Task 4: Notes (memory) server actions + tests

**Files:**
- Create: `src/server/actions/memory.ts`
- Create: `tests/server/memory.test.ts`

Operations: `addNote(trackId, body)`, `updateNote(noteId, body)`, `deleteNote(noteId)`, `getNotesForTrack(trackId)`.

### Step 1: Failing test

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("notes actions", () => {
  let trackId: string;

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({ where: { name: "NoteTest" }, create: { name: "NoteTest" }, update: {} });
    const album = await db.album.upsert({ where: { artistId_title: { artistId: artist.id, title: "NoteAlbum" } }, create: { title: "NoteAlbum", artistId: artist.id }, update: {} });
    const t = await db.track.create({
      data: {
        title: "NoteTrack", duration: 100,
        filePath: `/tmp/note-${Date.now()}.m4a`,
        sha256: `note-${Date.now()}`,
        primaryArtistId: artist.id, albumId: album.id, source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.songNote.deleteMany({ where: { trackId } });
    await db.track.deleteMany({ where: { id: trackId } });
    await db.album.deleteMany({ where: { title: "NoteAlbum" } });
    await db.artist.deleteMany({ where: { name: "NoteTest" } });
  });

  it("addNote + getNotesForTrack returns the new note", async () => {
    const { addNote, getNotesForTrack } = await import("@/server/actions/memory");
    await addNote(trackId, "Recommended by Sarah at coffee");
    const notes = await getNotesForTrack(trackId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Recommended by Sarah at coffee");
  });

  it("notes are ordered by createdAt desc (newest first)", async () => {
    const { addNote, getNotesForTrack } = await import("@/server/actions/memory");
    await addNote(trackId, "first");
    await new Promise((r) => setTimeout(r, 10));
    await addNote(trackId, "second");
    const notes = await getNotesForTrack(trackId);
    expect(notes.map((n) => n.body)).toEqual(["second", "first"]);
  });
});
```

### Step 2: Implement

`src/server/actions/memory.ts`:

```ts
"use server";
import { db } from "@/server/db";

export async function getNotesForTrack(trackId: string) {
  return db.songNote.findMany({
    where: { trackId },
    orderBy: { createdAt: "desc" },
    select: { id: true, body: true, createdAt: true, updatedAt: true },
  });
}

export async function addNote(trackId: string, body: string): Promise<{ id: string }> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("Note body is empty");
  const note = await db.songNote.create({
    data: { trackId, body: trimmed },
    select: { id: true },
  });
  return note;
}

export async function updateNote(noteId: string, body: string): Promise<void> {
  await db.songNote.update({ where: { id: noteId }, data: { body: body.trim() } });
}

export async function deleteNote(noteId: string): Promise<void> {
  await db.songNote.delete({ where: { id: noteId } });
}
```

### Step 3: Verify + Step 4: Commit

```bash
pnpm test
git add -A && git commit -m "feat(memory): song notes add/update/delete/list"
```

---

## Task 5: Settings screen + Rescan action

**Files:**
- Modify: `src/components/ipod/screens/HomeMenu.tsx` — add "Settings" row (now 4 items)
- Modify: `src/stores/ipod-store.ts` — add `{name:"settings"}` ScreenState
- Create: `src/components/ipod/screens/Settings.tsx`
- Modify: `src/components/ipod/Screen.tsx` — render Settings
- Modify: `src/components/ipod/Ipod.tsx` — handle navigation to settings + 4-item home

Settings rows:
1. Rescan Library (calls existing `rescanLibrary` server action; shows "Scanning…" then summary)
2. Logout (POST `/api/logout`, reload to `/login`)

### Implementation

`src/components/ipod/screens/Settings.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { rescanLibrary } from "@/server/actions/library";

interface SettingsProps {
  selected?: number;
}

const items = [
  { label: "Rescan Library" },
  { label: "Logout" },
];

export function Settings({ selected = 0 }: SettingsProps) {
  const [scanning, setScanning] = useState(false);
  const [scanReport, setScanReport] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: items.length } }));
  }, []);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        setScanning(true);
        setScanReport(null);
        void rescanLibrary()
          .then((r) => setScanReport(`+${r.added} added, ${r.skippedDuplicates} dupes, ${r.errors.length} errors`))
          .finally(() => setScanning(false));
      } else if (idx === 1) {
        void fetch("/api/logout", { method: "POST" }).then(() => location.replace("/login"));
      }
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Settings
      </div>
      <ul>
        {items.map((it, i) => (
          <li
            key={it.label}
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
      {(scanning || scanReport) && (
        <div className="px-2 py-2 text-center text-[10px] text-zinc-700">
          {scanning ? "Scanning..." : scanReport}
        </div>
      )}
    </div>
  );
}
```

Add to `HomeMenu`:
```tsx
const items = [
  { label: "Music" },
  { label: "Search" },
  { label: "Now Playing" },
  { label: "Settings" },
];
```

Update `Ipod.tsx` `handleSelect` home block:
```ts
if (sel === 0) push({ name: "musicSub" });
else if (sel === 1) push({ name: "search" });
else if (sel === 2) push({ name: "nowPlaying" });
else if (sel === 3) push({ name: "settings" });
```

Update home row count from 3 to 4.

Update `Screen.tsx`:
```tsx
case "settings":
  return <Settings selected={selected} />;
```

### Commit

```bash
git add -A && git commit -m "feat(settings): Settings screen with Rescan Library + Logout"
```

---

## Task 6: ArtistDetail + AlbumDetail screens (skeleton)

**Files:**
- Create: `src/components/ipod/screens/ArtistDetail.tsx`
- Create: `src/components/ipod/screens/AlbumDetail.tsx`
- Modify: `src/components/ipod/Screen.tsx`
- Modify: `src/components/ipod/Ipod.tsx` — navigation from ArtistList → ArtistDetail, AlbumList → AlbumDetail

Currently the ArtistList just exists, but pressing select on a row doesn't drill in (Phase 1 limitation). This task wires that up.

ArtistDetail shows all tracks by an artist, with a "♥ Favorite Artist" toggle at the top. Press Enter on a track → setQueue + nowPlaying.

AlbumDetail shows all tracks on an album, similar.

### Implementation

`src/components/ipod/screens/ArtistDetail.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getTracksByArtist, getArtists } from "@/server/actions/views";
import { toggleFavorite, isFavorited } from "@/server/actions/favorites";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface Props {
  artistId: string;
  selected?: number;
}

interface Row {
  id: string;
  title: string;
  duration: number;
  albumTitle: string;
}

export function ArtistDetail({ artistId, selected = 0 }: Props) {
  const [name, setName] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fav, setFav] = useState(false);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTracksByArtist(artistId), getArtists(), isFavorited("ARTIST", artistId)]).then(
      ([tracks, artists, f]) => {
        if (cancelled) return;
        const artist = artists.find((a) => a.id === artistId);
        setName(artist?.name ?? "Unknown");
        setRows(
          tracks.map((t) => ({
            id: t.id,
            title: t.title,
            duration: t.duration,
            albumTitle: t.album?.title ?? "",
          })),
        );
        setFav(f);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  // Row 0 is the favorite toggle; rows 1..N are tracks
  const total = 1 + rows.length;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: total } }));
  }, [total]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        void toggleFavorite("ARTIST", artistId).then(setFav);
        return;
      }
      const track = rows[idx - 1];
      if (!track) return;
      usePlayerStore.getState().setQueue(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          artist: name,
          album: r.albumTitle,
        })),
        idx - 1,
      );
      push({ name: "nowPlaying" });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, name, artistId, push]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {name}
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className={
            "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
            (selected === 0 ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white" : "")
          }
        >
          <span>{fav ? "♥ Favorited" : "♡ Favorite Artist"}</span>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i + 1 === selected ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white" : "")
            }
          >
            <span className="truncate">{r.title}</span>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

(AlbumDetail follows the same pattern using `getTracksByAlbum` + album-level favorite.)

Wire up `Screen.tsx`:
```tsx
case "artistDetail":
  return <ArtistDetail artistId={current.artistId} selected={selected} />;
case "albumDetail":
  return <AlbumDetail albumId={current.albumId} selected={selected} />;
```

Wire up `Ipod.tsx`:
- In `handleSelect` for `artistList`: instead of "fall through to nowPlaying", call `getArtists()` and `push({ name: "artistDetail", artistId: artists[sel].id })`.
- Same for `albumList` → `albumDetail`.

### Commit

```bash
git add -A && git commit -m "feat(detail): ArtistDetail + AlbumDetail screens with favorite + play"
```

---

## Task 7: PlaylistList + PlaylistDetail screens + new playlist input

**Files:**
- Create: `src/components/ipod/screens/PlaylistList.tsx`
- Create: `src/components/ipod/screens/PlaylistDetail.tsx`
- Create: `src/components/ipod/screens/TextInput.tsx` (shared inline-input primitive)
- Modify: `src/stores/ipod-store.ts` — add `{name:"playlistList"} | {name:"playlistDetail", playlistId} | {name:"newPlaylist"}`
- Modify: `src/components/ipod/screens/MusicSub.tsx` — add "Playlists" row
- Modify: `src/components/ipod/Screen.tsx`
- Modify: `src/components/ipod/Ipod.tsx` — handle navigation

PlaylistList has rows:
- "+ New Playlist" (always at top)
- existing playlists

Pressing select on "+ New Playlist" → push `newPlaylist` screen which shows a TextInput. Enter → `createPlaylist(name)` → pop + refresh list.

Pressing select on a playlist row → push `playlistDetail`.

PlaylistDetail shows tracks. Pressing select on a track → setQueue + nowPlaying.

### Commit

```bash
git add -A && git commit -m "feat(playlists): PlaylistList + PlaylistDetail + inline text input"
```

---

## Task 8: Favorites screen (browse favorited tracks)

**Files:**
- Create: `src/components/ipod/screens/FavoritesList.tsx`
- Modify: `src/stores/ipod-store.ts` — add `{name:"favoritesList"}`
- Modify: `src/components/ipod/screens/MusicSub.tsx` — add "Favorites" row
- Modify: `src/components/ipod/Screen.tsx`
- Modify: `src/components/ipod/Ipod.tsx`

Browse favorited tracks. Press select → setQueue + nowPlaying.

### Commit

```bash
git add -A && git commit -m "feat(favorites): FavoritesList browse screen"
```

---

## Task 9: NowPlaying heart toggle + Notes sub-screen

**Files:**
- Modify: `src/components/ipod/screens/NowPlaying.tsx` — show heart icon, allow toggling
- Create: `src/components/ipod/screens/Notes.tsx`
- Modify: `src/stores/ipod-store.ts` — add `{name:"notes", trackId}`
- Modify: `src/components/ipod/Ipod.tsx` — pressing center on NowPlaying cycles through sub-views (zoom art, notes, stats). Phase 3 implements the Notes branch.

NowPlaying shows heart icon overlay; pressing center cycles `nowPlaying → notes → nowPlaying`. While on notes, type a new note + Enter to add.

### Commit

```bash
git add -A && git commit -m "feat(now-playing): heart toggle + Notes sub-screen for journal entries"
```

---

## Task 10: File watcher auto-start via instrumentation

**Files:**
- Create: `src/instrumentation.ts`

Next.js 16 runs `instrumentation.ts` on app boot. We start the chokidar watcher there so new files dropped into `MUSIC_LIBRARY_PATH` get auto-ingested without a manual rescan.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWatcher } = await import("@/server/services/library-scanner");
  const { env } = await import("@/lib/env");
  startWatcher(env.MUSIC_LIBRARY_PATH);
  console.log(`[mu] chokidar watching ${env.MUSIC_LIBRARY_PATH}`);
}
```

### Commit

```bash
git add -A && git commit -m "feat(watcher): auto-start chokidar via Next 16 instrumentation hook"
```

---

## Task 11: End-to-end verification + merge

1. Restart dev server (instrumentation hook needs a fresh boot)
2. Verify watcher logs "chokidar watching..." in dev server output
3. Log in → home shows 4 items (Music, Search, Now Playing, Settings)
4. Music → 4 items (Artists, Albums, Songs, Favorites, Playlists — actually 5)
5. Play a song → heart it → see it in Favorites
6. Create a playlist → add a song → play from playlist
7. NowPlaying → press center → Notes screen → type "test note" + Enter → reload → note persists
8. Settings → Rescan Library → see report
9. Drop a new m4a in MUSIC_LIBRARY_PATH → wait ~2s → check DB has a new Track
10. `pnpm test` + `tsc --noEmit` + `eslint .` + `next build` all clean
11. Merge to main

### Commit

```bash
git checkout main
git merge --no-ff phase-3-personal-layer -m "Merge phase-3-personal-layer"
git branch -D phase-3-personal-layer
```

---

## Out of scope (Phase 4+)

- Tags UI (write/apply) — Phase 4
- Click-wheel-spell-letters search input — Phase 4 polish
- Playlist cover image upload — Phase 4
- Lyrics screen — out of MVP entirely
- MusicBrainz metadata enrichment — Phase 4 (this is its own big phase)
- Stats / Wrapped — Phase 5
- Cover Flow album browser — Phase 6
