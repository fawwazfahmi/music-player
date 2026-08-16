import { db } from "@/server/db";
import { searchYt as realSearchYt } from "@/server/services/yt-service";
import type { YtSearchResult } from "@/server/services/yt-service";

export interface SuggestYtParams {
  moodLabel: string;
  genreHints: string[];
  limit?: number;
}

export interface MoodYtDeps {
  searchYt?: (query: string, limit?: number) => Promise<YtSearchResult[]>;
}

/** Build a YouTube search query for a mood. Free-text moods ("rainy sunday")
    make great queries as-is; chip moods become "<mood> music", optionally
    sharpened by a genre hint. */
function buildQuery(moodLabel: string, genreHints: string[]): string {
  const hint = genreHints[0];
  const base = moodLabel.trim();
  if (hint) return `${hint} ${base} music`;
  return `${base} music`;
}

/** Suggest a few YouTube "fresh picks" for a mood, excluding anything already
    in the library. Best-effort: returns [] when search fails/yields nothing. */
export async function suggestYtForMood(
  params: SuggestYtParams,
  deps: MoodYtDeps = {},
): Promise<YtSearchResult[]> {
  const searchYt = deps.searchYt ?? realSearchYt;
  const limit = params.limit ?? 4;
  const query = buildQuery(params.moodLabel, params.genreHints);

  let results: YtSearchResult[] = [];
  try {
    results = await searchYt(query, limit * 3);
  } catch {
    return [];
  }
  if (results.length === 0) return [];

  // Drop anything already in the library.
  const ids = results.map((r) => r.videoId);
  const existing = await db.track.findMany({
    where: { ytVideoId: { in: ids } },
    select: { ytVideoId: true },
  });
  const have = new Set(existing.map((t) => t.ytVideoId));

  const seen = new Set<string>();
  const fresh: YtSearchResult[] = [];
  for (const r of results) {
    if (have.has(r.videoId) || seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    fresh.push(r);
    if (fresh.length >= limit) break;
  }
  return fresh;
}
