import { db } from "@/server/db";
import { resolveTrackCoverHash } from "@/lib/cover-url";
import { getAllMoods } from "@/server/services/mood-store";

const SEED_DECAY_K = 5; // learned signal reaches half-weight at this many events
const FAVORITE_BONUS = 0.15;
const GENRE_HINT_BONUS = 0.1;
const FRESH_BONUS = 0.05;
const RECENT_PENALTY = 0.2;
const THUMBS_DOWN_PENALTY = 0.3;
const ARTIST_CAP = 2; // max tracks per artist before we prefer variety
const RECENT_DAYS = 3;

/** Blend a listener-agnostic seed with per-listener learned score. The learned
    score's weight grows with how much signal we have (n), so a well-learned
    track trusts its learned value and a cold one trusts the seed. Bounded [0,1]. */
export function blendAffinity(seed: number, learned: number, signalCount: number): number {
  const s = clamp01(seed);
  const l = clamp01(learned);
  const w = signalCount / (signalCount + SEED_DECAY_K);
  return clamp01(w * l + (1 - w) * s);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export interface MoodPlaylistTrack {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtHash: string | null;
  ytVideoId: string | null;
  fit: number;
}

// The LLM re-ranker only perfects the songs she hears first, so we hand it a
// small pool — the rest keep formula order. Small pool keeps the "tap a mood"
// wait short (~4s vs ~13s for 40).
const RERANK_POOL = 12;

export interface SelectParams {
  listener: string;
  weights: Record<string, number>; // mood name -> weight
  genreHints: string[];
  limit?: number;
  /** Injectable RNG for deterministic tests; defaults to Math.random. */
  rng?: () => number;
  /** Human mood label for the LLM re-ranker (the hybrid ranker's LLM half). */
  moodLabel?: string;
  /** LLM re-ranker: reorders the formula's top pool best-first. Returns null to
      keep the formula order. Omitted → formula-only (deterministic). */
  rerank?: (
    moodLabel: string,
    candidates: { id: string; title: string; artist: string }[],
  ) => Promise<string[] | null>;
}

/** Select and rank library tracks for a mood blend. Formula-based and
    deterministic given `rng`. Library-only (Phase 2); YouTube gap-fill is layered
    on later. */
export async function selectMoodTracks(params: SelectParams): Promise<MoodPlaylistTrack[]> {
  const limit = params.limit ?? 30;
  const rng = params.rng ?? (() => 0);

  const moods = await getAllMoods();
  const idByName = new Map(moods.map((m) => [m.name, m.id]));
  const weightIds: string[] = [];
  const weightByMoodId = new Map<string, number>();
  for (const [name, w] of Object.entries(params.weights)) {
    const id = idByName.get(name);
    if (id && w > 0) {
      weightIds.push(id);
      weightByMoodId.set(id, w);
    }
  }

  const candidates = await db.track.findMany({
    where: { playable: true },
    select: {
      id: true,
      title: true,
      duration: true,
      coverArtHash: true,
      ytVideoId: true,
      primaryArtist: { select: { name: true } },
      primaryArtistId: true,
      album: { select: { title: true, coverArtHash: true } },
      genres: { select: { genre: { select: { name: true } } } },
      _count: { select: { favoritedBy: true } },
      moodSeeds: {
        where: weightIds.length ? { moodId: { in: weightIds } } : { moodId: { in: [] } },
        select: { moodId: true, score: true },
      },
      moodAffinities: {
        where: weightIds.length
          ? { listener: params.listener, moodId: { in: weightIds } }
          : { listener: params.listener, moodId: { in: [] } },
        select: {
          moodId: true,
          score: true,
          completes: true,
          skips: true,
          replays: true,
          thumbsUp: true,
          thumbsDown: true,
        },
      },
    },
  });

  const recent = await recentlyPlayed(params.listener);
  const hints = new Set(params.genreHints.map((g) => g.toLowerCase()));

  const scored = candidates.map((t) => {
    const seedByMood = new Map(t.moodSeeds.map((s) => [s.moodId, s.score]));
    const affByMood = new Map(t.moodAffinities.map((a) => [a.moodId, a]));

    let fit = 0;
    for (const [moodId, w] of weightByMoodId) {
      const seed = seedByMood.get(moodId) ?? 0;
      const aff = affByMood.get(moodId);
      const learned = aff?.score ?? 0;
      const n = aff
        ? aff.completes + aff.skips + aff.replays + aff.thumbsUp + aff.thumbsDown
        : 0;
      fit += w * blendAffinity(seed, learned, n);
      if (aff && aff.thumbsDown > 0) fit -= THUMBS_DOWN_PENALTY * w;
    }

    if (t._count.favoritedBy > 0) fit += FAVORITE_BONUS;
    if (hints.size > 0 && t.genres.some((g) => hints.has(g.genre.name.toLowerCase()))) {
      fit += GENRE_HINT_BONUS;
    }
    fit += recent.has(t.id) ? -RECENT_PENALTY : FRESH_BONUS;
    fit += rng() * 0.05;

    return {
      track: t,
      fit,
    };
  });

  scored.sort((a, b) => b.fit - a.fit);

  // Hybrid ranker: let the LLM re-order the formula's top pool for nuance.
  // Best-effort — on any failure we keep the formula order.
  let ordered = scored;
  if (params.rerank && params.moodLabel && scored.length > 1) {
    const pool = scored.slice(0, RERANK_POOL);
    let ids: string[] | null = null;
    try {
      ids = await params.rerank(
        params.moodLabel,
        pool.map((s) => ({ id: s.track.id, title: s.track.title, artist: s.track.primaryArtist.name })),
      );
    } catch {
      ids = null;
    }
    if (ids) {
      const byId = new Map(pool.map((s) => [s.track.id, s]));
      const reordered = ids.map((id) => byId.get(id)).filter((s): s is (typeof pool)[number] => !!s);
      ordered = [...reordered, ...scored.slice(RERANK_POOL)];
    }
  }

  // Artist diversity: greedily take up to ARTIST_CAP per artist, then relax to
  // fill up to the limit so a thin library is never starved.
  const perArtist = new Map<string, number>();
  const primary: typeof scored = [];
  const overflow: typeof scored = [];
  for (const s of ordered) {
    const n = perArtist.get(s.track.primaryArtistId) ?? 0;
    if (n < ARTIST_CAP) {
      perArtist.set(s.track.primaryArtistId, n + 1);
      primary.push(s);
    } else {
      overflow.push(s);
    }
  }
  const chosen = [...primary, ...overflow].slice(0, limit);

  return chosen.map((s) => ({
    id: s.track.id,
    title: s.track.title,
    duration: s.track.duration,
    artist: s.track.primaryArtist.name,
    album: s.track.album?.title ?? "",
    coverArtHash: resolveTrackCoverHash({
      trackCoverArtHash: s.track.coverArtHash,
      albumCoverArtHash: s.track.album?.coverArtHash,
    }),
    ytVideoId: s.track.ytVideoId ?? null,
    fit: s.fit,
  }));
}

async function recentlyPlayed(listener: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.listeningHistory.findMany({
    where: { listener, playedAt: { gte: cutoff } },
    select: { trackId: true },
    distinct: ["trackId"],
  });
  return new Set(rows.map((r) => r.trackId));
}
