# Music Universe — Design Spec

**Date:** 2026-06-04
**Status:** Design approved, pending implementation plan
**Owner:** fwzfhmy

A personal music streaming application styled as a literal Apple iPod Nano 2G (2006), with the click wheel as the primary navigation. Single-user with shared-password access. Local library scanning + YouTube fallback. MusicBrainz metadata enrichment. Memory-journal layer (notes, tags, discovery dates) over every track.

---

## 1. Decisions Locked

| # | Topic | Decision |
|---|---|---|
| 1 | Visual era | **iPod Nano 2G (2006)** — white aluminum chassis, blue gradient list highlights, Lucida/Helvetica typography, Chicago-style icons |
| 2 | Form factor | **Pure device** — a single iPod centered on a dark backdrop is the entire UI. No surrounding chrome, no side panels. |
| 3 | YouTube integration | **Stream-then-cache hybrid:** first play streams the YT m4a via proxy; in the background `yt-dlp` downloads the same m4a to local cache; subsequent plays serve from disk. Each YT-sourced track becomes a regular library track after caching. |
| 4 | Framework | **Next.js 15 App Router + TypeScript (strict) + Tailwind + shadcn/ui** |
| 5 | Click wheel input | **All three layered:** keyboard (arrows / Enter / Esc / Space), mouse-wheel scroll, circular pointer drag on the wheel rim, plus the four cardinal tap zones (MENU / ⏭ / ⏯ / ⏮) and center button. |
| 6 | Database | **PostgreSQL 16 + Prisma** with `pg_trgm` and GIN indexes for fuzzy search |
| 7 | User model | **Single-user, shared password.** No NextAuth. Notes/favorites/history are global. Cookie-based password gate via signed cookie. |
| 8 | Hosting | **Home machine + Cloudflare Tunnel** for friend access, **Docker-from-day-1** so a move to a VPS is just changing env vars + bind mounts. |
| 9a | Mobile interaction | **Touch-drag the wheel rim** — same iPod, scaled to fit, thumb spins. No alternative list view. |
| 9b | Library scale | **Large: 5,000 – 50,000 tracks.** Postgres GIN indexes, virtualized lists, pagination throughout. |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                 Browser (Next.js Client, App Router)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   IPOD COMPONENT (the entire UI)                          │   │
│  │   ┌────────────┐  ┌──────────────────────────────────┐   │   │
│  │   │   Screen   │  │ ClickWheel:                       │   │   │
│  │   │  (router-  │  │  · circular drag (pointer events) │   │   │
│  │   │   driven   │  │  · mouse wheel listener           │   │   │
│  │   │   views)   │  │  · keyboard handlers              │   │   │
│  │   └────────────┘  │  · touch drag                     │   │   │
│  │                   └──────────────────────────────────┘   │   │
│  │   Audio Engine: <audio>, queue, range-streaming           │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP (Cloudflare Tunnel ⟶ home machine)
┌────────────────────────▼─────────────────────────────────────────┐
│              Next.js Server (Route Handlers + Server Actions)    │
│  /api/audio/[trackId]        — unified playback: Range-streams    │
│                                local file OR proxies YT m4a URL   │
│                                based on Track.source               │
│  /api/art/[hash]             — serve cached cover art             │
│  /api/login                  — password gate                      │
│  Server Actions (auth-wrapped):                                   │
│    search, playback, library, playlists, memory, favorites, views │
│  Background workers (p-queue, in-process):                        │
│    · YT download worker  (yt-dlp ⟶ MUSIC_LIBRARY_PATH/.cache/)   │
│    · Metadata enrichment worker  (≥1000ms between MB calls)       │
│    · Library scan worker (chokidar watcher + tag reader)          │
└─┬───────────────────────────────────┬─────────────────────────────┘
  │                                   │
┌─▼─────────────┐                    ┌▼──────────────────────────┐
│ PostgreSQL 16 │                    │ Filesystem (env-driven)    │
│ + pg_trgm     │                    │ MUSIC_LIBRARY_PATH/        │
└───────────────┘                    │   Artist/Album/Track.m4a   │
                                     │   .cache/yt/<ytId>.m4a     │
                                     │   .cache/art/<hash>.jpg    │
                                     └────────────────────────────┘

External (rate-limited, cached in DB):
  · MusicBrainz Web Service (artist/album/track metadata, 1 req/s)
  · Cover Art Archive (release artwork)
  · YouTube via yt-dlp binary on host (search + audio extraction)
```

### Architectural commitments

1. **The iPod is one big stateful client component.** A finite state machine for screens, driven by click-wheel events. The screen is a viewport showing whatever state the machine is in. No client-side routing library — URL stays static, state lives in a Zustand store.
2. **All paths from env.** `MUSIC_LIBRARY_PATH`, `DATABASE_URL`, `YT_DLP_PATH`, `MUSICBRAINZ_USER_AGENT`, `APP_PASSWORD`, `COOKIE_SECRET`. Moving from laptop to VPS = changing env vars + bind-mounting the music folder.
3. **Dockerized from day 1.** `docker-compose.yml` with `app` (Next.js, includes yt-dlp + ffmpeg), `db` (Postgres 16 with `pg_trgm`). Volume mounts: music folder, postgres data.
4. **One playback path.** The audio engine **always** sets `<audio>.src = /api/audio/[trackId]`. The server-side handler inspects `Track.source`: if `LOCAL_SCAN` / `YT_CACHED` / `UPLOAD` it Range-streams the file from `filePath`; if `YT_STREAMING` it calls `yt-dlp -g` to resolve the current direct YT m4a URL and proxies the bytes (handling Range itself). The client never sees a YT URL.
5. **No NextAuth.** Overkill for one shared password. `middleware.ts` checks a signed cookie; `/api/login` validates `APP_PASSWORD` (bcrypt-hashed env var) and sets the cookie.
6. **Background work runs in-process.** No Redis / BullMQ. `p-queue` instances inside the Next.js Node runtime are sufficient for personal use. State persists in the `MetadataJob` and `YtCacheEntry` tables so interrupted work resumes after restart.

---

## 3. Data Model (Prisma Schema)

### Entity overview

- **Artist** — name, sortName, bio, photoUrl, mbid, discoveredAt
- **Album** — title, sortTitle, releaseDate, coverArtPath/Hash, totalDuration, artistId, mbid
- **Track** — title, duration, filePath (nullable), fileFormat, sha256, source (enum), ytVideoId, albumId, primaryArtistId, mbid, discoveredAt
- **TrackArtist** — many-to-many for features/remixers with role label
- **Genre**, **Tag** — m2m to Artist/Album/Track via join tables
- **SongNote** — many-per-track journal entries with body + timestamps
- **Playlist** + **PlaylistTrack** — with position for click-wheel reorder
- **ListeningHistory** — playedAt, durationListened, completed boolean, source enum
- **FavoriteTrack / FavoriteAlbum / FavoriteArtist** — three small tables (no polymorphism)
- **RelatedArtist** — directed edges with similarity score + source label
- **ExternalIdentifier** — polymorphic to {Artist|Album|Track}, multi-source metadata cache
- **YtCacheEntry** — status machine: PENDING → DOWNLOADING → READY|FAILED
- **MetadataJob** — queue rows for MusicBrainz enrichment workers
- **AppSetting** — key/value runtime config

### Key schema decisions

1. **No `User` table.** Single-user app. If multi-user later, add `User` + nullable `userId` FK on history/notes/favorites/playlists — additive migration.
2. **`Track.filePath` is nullable.** A track row can exist as YT-streaming-only with no file yet. Once cached, `filePath` is populated and `source` flips `YT_STREAMING` → `YT_CACHED`.
3. **Three `Favorite*` tables.** Prisma's polymorphism is awkward; three tables is cleaner than one with an `entityType` enum + nullable FKs.
4. **`SongNote` is many-per-track (journal style).** "Personal memories" is a list — dated entries — not a single field.
5. **`ListeningHistory` is the heavy table.** Wrapped, Most Played, trends all derive from it. Three indexes: `(playedAt)`, `(trackId, playedAt)`, and an expression index on `date_trunc('day', playedAt)`.
6. **`ExternalIdentifier`** future-proofs "support more music databases" — one row per (source, externalId, entity). MusicBrainz today, Discogs/Spotify/Last.fm later without schema changes.
7. **`YtCacheEntry` as a status machine** survives restarts — an interrupted download resumes from `DOWNLOADING` state.
8. **`MetadataJob`** persists pending enrichment across restarts (MusicBrainz allows only 1 req/s; in-memory queue would lose pending work).
9. **`TrackSource` enum on `Track`** (`LOCAL_SCAN | YT_CACHED | YT_STREAMING | UPLOAD`) — the player UI can show a small badge.

### Indexes (raw SQL migration)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX track_title_trgm  ON "Track"  USING gin (title gin_trgm_ops);
CREATE INDEX artist_name_trgm  ON "Artist" USING gin (name  gin_trgm_ops);
CREATE INDEX album_title_trgm  ON "Album"  USING gin (title gin_trgm_ops);

CREATE INDEX history_played_at      ON "ListeningHistory" ("playedAt");
CREATE INDEX history_track_played   ON "ListeningHistory" ("trackId", "playedAt");
CREATE INDEX history_played_day     ON "ListeningHistory" (date_trunc('day', "playedAt"));
```

### Sample blended search query

```sql
WITH q AS (SELECT $1::text AS query)
SELECT 'track'  AS kind, id, title AS label, similarity(title, q.query) AS score
  FROM "Track",  q WHERE title % q.query
UNION ALL
SELECT 'artist', id, name,  similarity(name,  q.query)  FROM "Artist", q WHERE name  % q.query
UNION ALL
SELECT 'album',  id, title, similarity(title, q.query)  FROM "Album",  q WHERE title % q.query
ORDER BY score DESC
LIMIT 30;
```

---

## 4. iPod UI / State Machine

### Screen state tree

```
                       HomeMenu (root)
   Music · Playlists · Now Playing · Stats · Search · Settings
     │       │            │           │       │         │
     ▼       ▼            ▼           ▼       ▼         ▼
  MusicSub  PLs       NowPlay     StatsMenu Search Settings
   │ │ │ │
   ▼ ▼ ▼ ▼
  Art Alb Sgn Gen
   │   │   │    │
   ▼   ▼   ▼    ▼
  ArtD AlD SgD GenD

  Sideways from NowPlaying (center-press cycles a sub-pane):
    NowPlaying → CoverArtZoom → Notes → Lyrics → TrackStats → back

  MENU button = pop one screen off the stack.
  Hold MENU ≥0.6s = pop to root.
  Center button = enter/select.
```

### Component contract

- **`<Ipod>`** renders the chassis + screen + click wheel. Owns no business logic.
- **`<ClickWheel>`** emits one of six events: `scroll(delta: -1 | 1)`, `select`, `menu`, `prev`, `next`, `playPause`. Three input layers (keyboard / mouse wheel / pointer-drag-on-rim) plus cardinal tap zones converge into these six events. Mobile touch-drag uses the same pointer events.
- **`<Screen>`** is a switch on the top of `navStack` — renders one of ~15 screen views. Each view is pure: takes a `ScreenState`, produces 176px × 132px markup (scaled up via CSS for legibility — actual logical size is responsive), returns a wheel-event handler.
- **Zustand store** holds `{ navStack: ScreenState[], player: PlayerState, wheelGesture: ActiveGesture }`. Navigation = push/pop on `navStack`. URL stays at `/`.
- **Virtualized lists** via `@tanstack/react-virtual` inside the screen so 50k rows scroll smoothly with only ~12 items in the DOM.
- **Audio engine** is a singleton wrapping one `<audio>` element + `MediaSession` API (so OS lock-screen and Bluetooth headphone controls work). Queue lives in Zustand. Range requests handled by the browser automatically.
- **Cover Flow** is its own screen state — horizontal carousel of album art with CSS 3D transforms; click-wheel rotates the carousel.

### Screen inventory (15 views)

`HomeMenu`, `MusicSub`, `ArtistList`, `ArtistDetail`, `AlbumList`, `AlbumDetail`, `SongList`, `SongDetail`, `GenreList`, `PlaylistList`, `PlaylistDetail`, `NowPlaying`, `CoverArtZoom`, `Notes`, `Lyrics` (placeholder — out of MVP scope), `TrackStats`, `Search`, `SearchResults` (Local + YT sections), `YtPicker`, `StatsMenu`, `Wrapped` (multi-step), `Settings`, `NeedsReview`, `Login`.

---

## 5. Metadata & YouTube Pipeline

### Library scan flow

```
chokidar watcher on MUSIC_LIBRARY_PATH
  ├─ file added/changed → ingestFile(path)
  │     1. read ID3 tags (music-metadata npm package)
  │     2. compute sha256 of file contents
  │     3. upsert Artist(name) → upsert Album(artistId, title) → upsert Track
  │     4. dedupe: if sha256 already exists → skip and log
  │     5. enqueue MetadataJob(track)
  └─ file removed → mark Track.playable = false (preserve history & notes)
```

### Metadata enrichment worker

Singleton, `p-queue` concurrency = 1, rate-limited to ≥1000ms between MusicBrainz HTTP calls. `MUSICBRAINZ_USER_AGENT` set per their etiquette.

Loop:
1. Pull next `QUEUED` MetadataJob (oldest first).
2. Query MusicBrainz `/ws/2/recording?query=artist:X AND recording:Y`.
3. If single match with score ≥85 → write metadata, ExternalIdentifier, mark `DONE`.
4. If ambiguous (multiple ≥70 matches) → leave `Track.metadataFetched` null, mark `FAILED` with `multi-match` reason, surface in **Settings › Library › Needs Review**.
5. If single match found and release MBID present → enqueue Cover Art fetch.
6. On artist resolved for the first time → enqueue artist bio + related artists jobs.

### Cover Art Archive fetcher

Separate worker (lower priority, same queue or separate queue). For a release MBID → GET `https://coverartarchive.org/release/{mbid}/front` → save bytes to `MUSIC_LIBRARY_PATH/.cache/art/<sha256>.jpg` → update `Album.coverArtPath` + `coverArtHash`.

### YouTube flow

```
user types in Search, no strong local match
  → /api/yt/search?q=...            (yt-dlp --search1: → top 5 results)
  → user selects a result on the YtPicker screen
  → server.selectYtResult(ytId, originalQuery):
        - create Track stub (source=YT_STREAMING, filePath=null, ytVideoId=ytId)
        - create YtCacheEntry(ytVideoId, status=PENDING)
        - return { trackId }
  → audio engine plays from /api/audio/[trackId] (the only playback path)
        server inspects Track.source=YT_STREAMING, runs yt-dlp -g, proxies bytes
  → background worker: yt-dlp -f 'bestaudio[ext=m4a]' downloads to
        MUSIC_LIBRARY_PATH/.cache/yt/<ytId>.m4a
  → on completion:
        - compute sha256 → update Track.filePath / fileFormat / sha256
        - flip Track.source = YT_CACHED, YtCacheEntry.status = READY
        - enqueue MetadataJob to enrich with MusicBrainz data
  → next play of this track is served from /api/audio/[trackId]
        (local file, HTTP Range requests, no YT involvement)
```

### Failure handling

- YT URL expires mid-stream → server re-resolves with `yt-dlp -g` and re-proxies; client `<audio>` continues with brief gap (or a "skipping…" indicator).
- yt-dlp download fails → `YtCacheEntry` flips to `FAILED` with `errorMessage`, `attempts` increments; retry on user request.
- MusicBrainz returns 503 / rate-limit → exponential backoff, job stays `QUEUED`.

---

## 6. API Surface

### Route Handlers

| Endpoint | Purpose |
|---|---|
| `GET /api/audio/[trackId]` | **Unified playback.** Range-streams local file OR proxies YT m4a (based on `Track.source`). Only endpoint the audio engine ever hits. |
| `GET /api/art/[hash]` | Serves cached cover art from `.cache/art/` |
| `POST /api/login` | Sets signed cookie if `APP_PASSWORD` matches |
| `POST /api/logout` | Clears cookie |

### Server Actions

All wrapped in `withAuth` middleware that verifies the signed cookie. All return type-safe payloads consumed by the iPod client.

```
search:        searchLibrary(q)                            → {tracks, artists, albums}
               searchYt(q)                                  → YtResult[]
               selectYtResult(ytId, originalQuery)          → {trackId, streamUrl}

playback:      startPlay(trackId)                           → historyId
               updatePlayProgress(historyId, secs, done)    → void

library:       rescanLibrary()                              → ScanReport
               refreshMetadata(kind, id)                    → void
               markTrackMissing(trackId)                    → void
               addManualMetadataMatch(trackId, mbid)        → void

playlists:     createPlaylist(name)                         → playlistId
               renamePlaylist(id, name), deletePlaylist(id)
               addToPlaylist(playlistId, trackId, pos?)
               removeFromPlaylist(playlistId, trackId)
               reorderPlaylist(playlistId, trackIds[])
               setPlaylistCover(id, file)

memory:        addNote(trackId, body)                       → noteId
               updateNote(noteId, body), deleteNote(noteId)
               setTrackDiscoveredAt(trackId, date)
               addTag(kind, id, tagName), removeTag(...)

favorites:     toggleFavorite(kind, id)   // kind = TRACK|ALBUM|ARTIST

views:         getDashboard()                               → DashboardPayload
               getArtistPage(id)                            → ArtistPagePayload
               getAlbumPage(id)                             → AlbumPagePayload
               getTrackDetail(id)                           → TrackDetailPayload
               getWrapped(year, month?)                     → WrappedScreens[]
               getDiscoveryTimeline()                       → TimelineEntry[]
               getNeedsReview()                             → AmbiguousMatch[]
```

---

## 7. Build Order (Phases)

Each phase is independently usable; the app is deployable at the end of every phase.

### Phase 0 · Foundation (~½ day)
Next.js 15 scaffold, Tailwind, shadcn/ui, TypeScript strict, ESLint + Prettier, `docker-compose.yml` (`app` + `db`), Prisma schema + initial migration including `pg_trgm` extension + GIN indexes via raw SQL migration, env config, password-gate middleware + signed-cookie auth, iPod-styled login screen.

### Phase 1 · Library + Player (~3 days)
- `chokidar` library scanner + ID3 ingest via `music-metadata`
- iPod chassis component (visual fidelity to Nano 2G)
- ClickWheel component with all three input layers + cardinal tap zones
- Zustand state machine + navigation stack
- Screens: `HomeMenu`, `MusicSub`, `ArtistList`, `AlbumList`, `SongList`, `NowPlaying`
- Audio engine: Range-streaming `/api/audio/[trackId]`, queue, shuffle, repeat, volume, seek, MediaSession integration
- ListeningHistory recording (start, progress, completed at ≥80%)

### Phase 2 · Search + YT Fallback (~2 days)
- Search screen (keyboard text input first; click-wheel-spell-letters is a stretch)
- pg_trgm fuzzy local search across tracks/artists/albums
- YT search via `yt-dlp --search1:`
- `YtPicker` screen
- Stream-then-cache pipeline with `YtCacheEntry` status machine
- "Downloading…" badge in NowPlaying for streaming tracks

### Phase 3 · Personal Layer (~2 days)
- `SongNote` journal entries (inline editor in NowPlaying sub-screen `Notes`)
- Tags (system tags + custom user tags)
- Favorites (heart toggle in NowPlaying and list rows)
- Playlists full CRUD with click-wheel reorder
- Custom playlist cover image upload

### Phase 4 · Metadata Enrichment (~3 days)
- MetadataJob queue worker (1 req/s MusicBrainz)
- Cover Art Archive fetcher
- Manual correction UI (`Settings › Library › Needs Review`)
- `ArtistDetail` screen (bio + albums grid + related artists list + stats)
- `AlbumDetail` screen with cover-flow-style detail
- Related Artists rendered as a chain of iPod screens you click into

### Phase 5 · Stats & Wrapped (~2 days)
- `StatsMenu`: Recently Played, Top Songs / Artists / Albums (this week / month / year / all-time)
- Wrapped views as a scrollable sequence of iPod screens (click-wheel Instagram-story style)
- Discovery timeline (tracks grouped by `discoveredAt` month)
- Listening day-of-week aggregate

### Phase 6 · Polish & Deployment (~1 day)
- Cover Flow album browser
- Cloudflare Tunnel setup docs + Dockerfile production target
- Backup script (`pg_dump` + `rsync` of music folder)
- Touch-drag fine-tuning on mobile
- Sleep mode (dim screen after inactivity, MENU to wake)

**Total estimate: ~13 working days. Deployable after Phase 0.**

---

## 8. Folder Structure

```
music-player/
├─ docker-compose.yml
├─ Dockerfile                           # multi-stage: deps → build → runtime (with yt-dlp + ffmpeg)
├─ package.json
├─ tsconfig.json
├─ tailwind.config.ts
├─ .env.example
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
│     ├─ 0_init/
│     └─ 1_pg_trgm_and_indexes/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                     # root layout with iPod backdrop
│  │  ├─ page.tsx                       # the iPod page (single route)
│  │  ├─ login/page.tsx
│  │  └─ api/
│  │     ├─ audio/[trackId]/route.ts    # unified playback (local + YT proxy)
│  │     ├─ art/[hash]/route.ts
│  │     ├─ login/route.ts
│  │     └─ logout/route.ts
│  ├─ middleware.ts                     # password gate
│  ├─ server/
│  │  ├─ actions/                       # all server actions
│  │  │  ├─ search.ts
│  │  │  ├─ playback.ts
│  │  │  ├─ library.ts
│  │  │  ├─ playlists.ts
│  │  │  ├─ memory.ts
│  │  │  ├─ favorites.ts
│  │  │  └─ views.ts
│  │  ├─ services/
│  │  │  ├─ audio-stream.ts             # HTTP Range helper
│  │  │  ├─ library-scanner.ts          # chokidar + ingest
│  │  │  ├─ id3-reader.ts
│  │  │  ├─ metadata-service.ts         # MusicBrainz + CAA + cache
│  │  │  ├─ yt-service.ts               # wraps yt-dlp invocations
│  │  │  ├─ queue.ts                    # p-queue singletons (yt, metadata, art)
│  │  │  └─ search.ts                   # pg_trgm helpers
│  │  ├─ db.ts                          # PrismaClient singleton
│  │  └─ auth.ts                        # cookie sign/verify
│  ├─ components/
│  │  ├─ ipod/
│  │  │  ├─ Ipod.tsx
│  │  │  ├─ Chassis.tsx
│  │  │  ├─ Screen.tsx
│  │  │  ├─ ClickWheel.tsx
│  │  │  ├─ wheel-gestures.ts           # pointer + keyboard + scroll
│  │  │  └─ screens/
│  │  │     ├─ HomeMenu.tsx
│  │  │     ├─ MusicSub.tsx
│  │  │     ├─ ArtistList.tsx
│  │  │     ├─ ArtistDetail.tsx
│  │  │     ├─ AlbumList.tsx
│  │  │     ├─ AlbumDetail.tsx
│  │  │     ├─ SongList.tsx
│  │  │     ├─ SongDetail.tsx
│  │  │     ├─ GenreList.tsx
│  │  │     ├─ PlaylistList.tsx
│  │  │     ├─ PlaylistDetail.tsx
│  │  │     ├─ NowPlaying.tsx
│  │  │     ├─ Notes.tsx
│  │  │     ├─ TrackStats.tsx
│  │  │     ├─ Search.tsx
│  │  │     ├─ YtPicker.tsx
│  │  │     ├─ StatsMenu.tsx
│  │  │     ├─ Wrapped.tsx
│  │  │     ├─ NeedsReview.tsx
│  │  │     └─ Settings.tsx
│  │  ├─ ui/                            # shadcn primitives
│  │  └─ login/LoginScreen.tsx
│  ├─ stores/
│  │  ├─ ipod-store.ts                  # Zustand: navStack + wheel gesture
│  │  └─ player-store.ts                # Zustand: queue + playback state
│  ├─ audio/
│  │  ├─ engine.ts                      # singleton <audio> manager
│  │  └─ media-session.ts               # OS lock-screen integration
│  ├─ lib/
│  │  ├─ cn.ts
│  │  ├─ format-duration.ts
│  │  └─ similarity.ts                  # client-side ranking helper
│  └─ types/
│     └─ payloads.ts                    # shared types between actions and UI
├─ scripts/
│  ├─ backup.sh                         # pg_dump + rsync music folder
│  └─ tunnel.sh                         # cloudflared quick-launch
└─ docs/
   └─ superpowers/
      └─ specs/
         └─ 2026-06-04-music-universe-design.md  ← this file
```

---

## 9. Environment Variables

```env
# Database
DATABASE_URL="postgresql://music:music@localhost:5432/music_universe"

# Filesystem
MUSIC_LIBRARY_PATH="/srv/music"        # the watched root folder

# YT
YT_DLP_PATH="/usr/local/bin/yt-dlp"
FFMPEG_PATH="/usr/local/bin/ffmpeg"

# MusicBrainz etiquette
MUSICBRAINZ_USER_AGENT="MusicUniverse/1.0 ( fwzfhmy@gmail.com )"

# Auth
APP_PASSWORD_HASH="$2b$12$..."         # bcrypt of shared password
COOKIE_SECRET="32+ random bytes"        # HMAC for signed cookies
```

---

## 10. Out-of-Scope (explicitly deferred)

- **Multi-user accounts.** Single-user with shared password is the locked decision.
- **Lyrics.** `Lyrics` screen is a placeholder in the state machine; no provider integration in MVP.
- **`pgvector` / ML similarity.** Related artists come from MusicBrainz, not embeddings.
- **Mobile-list-fallback.** Mobile uses touch-drag the wheel; no alternative non-iPod layout.
- **Hi-res / FLAC / lossless.** m4a is the canonical format. Local FLACs play if they exist, but YT cache is m4a-only.
- **NextAuth, magic links, OAuth.** Cookie + single password.
- **Public sign-ups.** Hardcoded password.
- **Offline PWA / install-to-home-screen.** Out of MVP; revisit after Phase 6.
- **Spotify / Apple Music / Last.fm import.** Library is local files + YT only.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| YT URLs rotate / yt-dlp breaks when YouTube changes their player | Pin `yt-dlp` to a known-good version + auto-update on container rebuild; document the upgrade path. |
| MusicBrainz mismatches on ambiguous titles | Manual correction surface in `NeedsReview`; never silently overwrite metadata with a low-confidence match (≥85 similarity threshold). |
| Cloudflare Tunnel exposes my home machine | Tunnel is outbound-only, no inbound ports opened; password gate is in front of every route; only static assets and `/api/login` are reachable pre-auth. |
| 50k tracks slow page renders | Virtualized lists in the iPod screen; pagination on heavy screens; GIN indexes; aggregate views pre-computed on stats menu open (with cache-control). |
| Notes are shared / privacy leak between user + friend | Documented in spec; user accepted the trade-off. Tag system can act as soft-privacy ("personal" tag hides note from default view) — leave as a Phase 3 polish item. |
| Click wheel is unusable for typing search | Phase 2 uses physical keyboard text input first. Click-wheel-spell-letters is a deferred polish item. |
| YT downloads fill disk | Cache folder is on the same volume as the music library; a Phase 6 polish item adds a configurable size cap with LRU eviction. |

---

**End of design spec.**
