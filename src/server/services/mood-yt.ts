import { db } from "@/server/db";
import { searchYt as realSearchYt } from "@/server/services/yt-service";
import type { YtSearchResult } from "@/server/services/yt-service";
import { topArtists, buildTasteQueries, interleaveFresh } from "@/lib/yt-taste-query";

// Bound latency: at most 2 artist + 1 genre + 1 generic query per suggestion.
const ARTIST_SEEDS = 2;
const GENRE_SEEDS = 1;
const PER_QUERY = 4;

export interface SuggestYtParams {
  moodLabel: string;
  genreHints: string[];
  limit?: number;
  /** Her highest-fit library artists for this mood (fit-ordered) — the taste seed. */
  seedArtists?: string[];
  /** Artists she thumbs-downed for this mood; results by them are dropped. */
  downrankArtists?: string[];
}

export interface MoodYtDeps {
  searchYt?: (query: string, limit?: number) => Promise<YtSearchResult[]>;
}

/** Suggest a few YouTube "fresh picks" for a mood, seeded by her taste for it
    (top artists + the mood's genre hints) and excluding anything already in the
    library. Best-effort: returns [] when search fails/yields nothing. */
export async function suggestYtForMood(
  params: SuggestYtParams,
  deps: MoodYtDeps = {},
): Promise<YtSearchResult[]> {
  const searchYt = deps.searchYt ?? realSearchYt;
  const limit = params.limit ?? 4;

  const seedArtists = topArtists((params.seedArtists ?? []).map((artist) => ({ artist })), ARTIST_SEEDS);
  const seedGenres = topArtists((params.genreHints ?? []).map((artist) => ({ artist })), GENRE_SEEDS);
  const queries = buildTasteQueries({ moodLabel: params.moodLabel, seedArtists, seedGenres });

  const lists: YtSearchResult[][] = [];
  for (const q of queries) {
    try {
      lists.push(await searchYt(q, PER_QUERY));
    } catch {
      /* one failed query shouldn't sink the rest */
    }
  }
  if (lists.every((l) => l.length === 0)) return [];

  // Drop anything already in the library.
  const ids = lists.flat().map((r) => r.videoId);
  const existing = await db.track.findMany({
    where: { ytVideoId: { in: ids } },
    select: { ytVideoId: true },
  });
  const excludeVideoIds = new Set(existing.map((t) => t.ytVideoId).filter((x): x is string => !!x));

  return interleaveFresh(lists, {
    limit,
    excludeVideoIds,
    downrankArtists: params.downrankArtists ?? [],
  });
}
