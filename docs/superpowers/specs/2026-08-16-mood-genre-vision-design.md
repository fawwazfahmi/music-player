# Mood, Genre & Self-Learning — Umbrella Vision

**Date:** 2026-08-16
**Status:** Vision approved. This is the umbrella design; each phase gets its own focused spec → plan → build cycle.

## Summary

Give Kyowave two new ways for a listener to reach music, plus the machinery to get
smarter over time:

1. **Browse songs by genre** — a factual "what kind of music is this" axis.
2. **Ask her mood and build a matching playlist** — a subjective "how does this feel /
   when would she play it" axis, driven by a small set of fixed moods that free text is
   interpreted into.
3. **Learn her taste per mood** from what she does (completes, skips, replays, favorites)
   and occasional light 👍/👎 asking — separately for each listener.
4. **Reach beyond the library into YouTube** to fill thin moods and surface fresh picks.
5. **Promote a liked YouTube pick to permanent** by downloading it into the library.

The "intelligence" runs **locally via Ollama** (like Whisper already does): private, free,
and gracefully degrading when it's off.

## Decisions locked during brainstorming

- **Mood model:** fixed built-in mood chips **and** free text she can type.
- **Intelligence:** local Ollama (configurable URL + model), never a hard dependency.
- **Learning:** mostly passive signals + occasional light asking (not per-song homework).
- **YouTube reach:** fill gaps + a few fresh picks (not discovery-forward, not YT-only).
- **Ranking role:** **hybrid** — a scoring formula does the heavy lifting; Ollama re-ranks a
  small shortlist for nuance and is skipped when unavailable.
- **Listener scope:** learning is **per-listener** (`ainul` / `fawwaz`); mood vocabulary is
  shared.

## The core mental model — two axes

- **Genre** = objective label (Pop, R&B, Lo-fi, Rock…). A flat, factual tag. Powers
  "list songs by genre."
- **Mood** = subjective, contextual (Happy, Chill, Sad, Energetic, Focus, Romantic,
  Nostalgic… + free text). A song serves **many** moods with different strengths — a
  *weighted affinity*, not a single label. This is the axis the app **learns** on.

**Fixed axes make free text learnable.** The built-in moods are the fixed dimensions the
app learns along. Free text is **interpreted into a blend of those built-ins** (e.g.
"rainy sunday" → 70% Chill + 40% Nostalgic + a lo-fi/acoustic genre hint) rather than
becoming its own orphan mood. Playlists are built from the blend; feedback trains the same
fixed moods. Without this, every phrase becomes a one-off mood that never gathers enough
signal to learn from. (A frequently-reused phrase can later be *saved* as a named preset —
still just a stored blend underneath.)

**Per-listener taste, shared vocabulary.** `ainul` and `fawwaz` each build their own mood
profiles; the list of moods is shared. Mirrors the existing `ListeningHistory.listener`
identity.

## Data model changes

New Prisma models; nothing existing is broken.

### Genres (Phase 1)
- **`TrackGenre`** — join of `trackId` + `genreId`. Genre at the **song** level so
  YouTube downloads (which share one "YouTube" album and carry no MusicBrainz data) can
  still be labeled. `Genre` already exists but today only links to artists/albums.

### Moods
- **`Mood`** — the vocabulary. `id`, `name`, `emoji`, `kind` (`BUILTIN` | `CUSTOM`).
  Built-ins seeded: Happy, Chill, Sad, Energetic, Focus, Romantic, Nostalgic. These are
  the fixed learning axes. Free-text moods do **not** create rows here.
- **`TrackMoodAffinity`** — the heart of the system. One row per
  `(listener, trackId, moodId)`: `score` (0–1), raw counters `completes`, `skips`,
  `replays`, `thumbsUp`, `thumbsDown`, and `source` (`LLM_SEED` | `LEARNED`). Seeded once
  by Ollama, then nudged continuously by behavior. `listener` is part of its identity.
- **`MoodSession`** — one "she asked for a mood" event: `id`, `listener`, `moodId?` (null
  for pure free text), `freeText?`, `interpretation` (JSON blend Ollama produced),
  `createdAt`. Provides the context that makes feedback meaningful ("skipped *while in a
  Chill session*").
- **`MoodFeedback`** — lightweight event log: `sessionId`, `trackId`, `verdict`
  (`FIT` | `MISS`), `at`. Feeds the affinity counters; kept as a log so scores can be
  re-derived if the formula changes.

### Reused as-is
- `TrackSource` / `YtCacheEntry` / `yt-download-queue` → promote-to-permanent.
- `Playlist` rendering → the generated mood list.
- `ListeningHistory.listener` → identity + a passive signal source.

## The intelligence layer (Ollama)

One new service, `src/server/services/mood-llm.ts` — a thin client to local Ollama,
configurable via `OLLAMA_URL` + `OLLAMA_MODEL` (default a small model, e.g. `llama3.1:8b`).
It has **three** jobs, none of which is a hard dependency:

1. **Interpret free text** — `interpretMood("rainy sunday")` → a blend over built-in moods
   plus optional genre/energy hints. One fast call when she submits a mood.
2. **Seed a track offline** — `seedTrack(track)` from title + artist + known genre →
   initial mood affinities (`source: LLM_SEED`) and genre labels. The **cold-start**
   answer to "how does it know a song is chill before any feedback." Runs **once per track,
   cached**, batched, as a background job; never blocks playback. New downloads are
   auto-seeded.
3. **Re-rank the shortlist** — given a small candidate pool, reorder for nuance. Bounded
   input, bounded latency.

**Graceful degradation.** If Ollama is unreachable: free text falls back to keyword→mood
matching; unseeded tracks fall back to genre/tag-derived affinity; the re-rank step is
skipped and the formula order ships. The feature keeps working — just a bit dumber — and
back-fills seeds when Ollama returns.

Genre population uses the same labeler: MusicBrainz where it has data, Ollama fallback
otherwise, the existing tag UI for manual override.

## Selection & learning algorithm

### Generating a playlist
For interpreted mood-blend `W` (weights over built-in moods) and listener `L`:

1. **Score every candidate:** `fit(t) = Σ_m W[m] · affinity(L, t, m)`, where `affinity`
   blends the learned score with the LLM seed, and **the seed's influence decays as real
   feedback accumulates** (a track with many completes in Chill trusts its learned score,
   not the cold-start guess).
2. **Adjust:** small bonus for favorites and genre-hint matches; freshness bonus for
   not-recently-played; penalty for recently played (avoid repeats) and for anything
   thumbed-down in this mood.
3. **Take the top ~40** as the candidate pool.
4. **Ollama re-ranks that pool** for nuance (skipped if Ollama is off).
5. **Diversify & finalize:** cap songs per artist; add a little controlled randomness so
   the same mood isn't an identical list every time; take the final N.
6. **Gap-fill (Phase 4):** if too few tracks clear a fit threshold, blend in a few
   YouTube suggestions.

### How scores move
Every signal updates the `TrackMoodAffinity` counters for the session's dominant mood(s),
weighted by `W`:

| Signal | Effect |
|---|---|
| Completed the song | `+completes` (gentle positive) |
| Replayed it | `+replays` (strong positive) |
| Favorited during the session | strong positive |
| Skipped early | `+skips` (negative) |
| 👍 "fits your <mood>" | `+thumbsUp` (strong, explicit) |
| 👎 "doesn't fit" | `+thumbsDown` (strong negative; also suppresses in this mood) |

`score` is recomputed from the counters with light smoothing (one skip doesn't nuke a
song), blended with the decaying seed. Raw counters + `MoodFeedback` events are logged so
scores can be re-derived if the formula changes.

**Key property:** signals attach to the **mood she was in**, not to the song globally — so
a song can be great for Energetic and wrong for Sad, and the app learns exactly that.

## UX flows

1. **Asking her mood.** Warm entry point on Home ("How are you feeling, Kyote?") + a
   persistent **Mood** nav item. Built-in mood chips (with emoji) + a text field ("…or say
   it in your own words"). Chip → instant playlist; free text → one quick interpret, then
   play.
2. **During playback.** Normal player and queue; the mood playlist is a real, scrollable
   list. Signals captured silently. **Light asking:** occasionally (after a few tracks, or
   when the engine is genuinely unsure) a subtle, dismissable inline 👍/👎 on now-playing —
   *"Fit your Chill?"* — never blocking.
3. **Fresh picks from YouTube (Phase 4).** When the library is thin for a mood, a few
   YouTube suggestions blend in, clearly badged as streaming / not-yet-in-library, played
   via the existing YT streaming path.
4. **Promote to permanent (Phase 5).** On a liked YT fresh pick (favorite, 👍, or explicit
   "Keep in Kyowave") → hand to the existing `yt-download-queue` → background download
   (current DownloadsPage/indicators show progress) → becomes a normal `YT_CACHED` track.
   Mood affinities carry over from the session.
5. **Genres (Phase 1).** A **Genres** page: grid of genres → tap → songs in it, reusing
   `SongsPage` list rendering.

**UX calls:**
- The mood playlist **replaces the queue** when started (like starting any playlist), not
  appends — she's choosing a vibe, not adding to a pile.
- **Light-asking frequency is a setting** (default: gentle) so it can be dialed down
  without a code change.

## Phasing (build order)

Each phase ships usable value and gets its own spec → plan → build cycle.

- **Phase 1 — Genres.** `TrackGenre` + population (MusicBrainz → Ollama fallback → manual)
  + a Genres browse page. Stands up the Ollama service skeleton early (used lightly here),
  de-risking it.
- **Phase 2 — Mood engine core.** `Mood` / `TrackMoodAffinity` / `MoodSession` models,
  free-text interpretation, offline track seeding, scoring formula + hybrid re-rank, the
  mood-ask UI, and a generated playlist **from the library only**. Passive signals captured;
  no learning-driven changes yet (seeded scores drive selection).
- **Phase 3 — Learning + light asking.** Wire signals into `TrackMoodAffinity`, the
  occasional 👍/👎 prompt, `MoodFeedback` log, seed-decay. Playlists visibly get smarter
  per listener, per mood.
- **Phase 4 — YouTube reach.** Gap-fill + a few badged, streamed fresh picks in thin moods.
- **Phase 5 — Promote to permanent.** "Keep in Kyowave" → existing download queue →
  `YT_CACHED`, affinities carried over.

**Dependencies:** 2 needs 1's Ollama skeleton · 3 needs 2 · 4 needs 2 · 5 needs 4.

## Open questions / deferred

- Exact built-in mood set is a starting point; can be tuned after real use.
- Named/saved free-text presets ("rainy sunday" as a reusable mood) — deferred; the model
  supports it later via `Mood.kind = CUSTOM`.
- Precise scoring constants (smoothing, decay rate, freshness window, artist-diversity cap)
  are tuning parameters, settled during Phase 2/3 implementation, not here.

## Phase 6 — Audio analysis (added after the original vision)

Added because inferring mood from title/artist/genre alone proved too thin. The
engine now **hears the song**:

- **Signal:** local Essentia + pre-trained MTG **MusiCNN-MSD** models —
  `mood_happy`, `mood_sad`, `mood_relaxed`, `mood_aggressive`, `mood_party`,
  `danceability` — plus objective `tempo`/`key`/`scale`. Run in a Python venv
  (`.venv-audio`, gitignored) reproduced by `scripts/audio/setup.sh`; extractor
  at `scripts/audio/extract_features.py`.
- **Storage:** `TrackAudioFeatures` table. Node side: `audio-analysis.ts` maps
  model outputs onto our mood axes (`audioMoodScores`) and blends them into the
  seeder **audio-weighted 0.6** (`blendSeedScores`).
- **Lyrics + loudness** also feed the seeder (70/73 tracks had Whisper lyrics;
  ffmpeg gives an energy proxy) — a lighter upgrade shipped alongside.
- **Not a trained-from-scratch model:** valence/danceability can't be trained
  here (no labels), so we run open *pre-trained* models. Valence/arousal
  (emomusic/deam) weren't available at the `/classifiers/` URL, so only the six
  mood/danceability heads are wired; romantic/nostalgic remain LLM/lyrics-driven.
- **Population:** new downloads analyzed in the metadata worker (best-effort);
  `scripts/backfill-audio-features.ts` for the existing library.
