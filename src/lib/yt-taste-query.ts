// Taste-aware query building for YouTube mood picks — pure, no network/DB.
// The mood flow already scores her library; these turn that into search queries
// seeded from what she actually likes for the mood, instead of a generic phrase.

import type { YtSearchResult } from "@/server/services/yt-service";

/** Distinct artists in the given (fit-ordered) list, capped. */
export function topArtists(tracks: { artist: string }[], cap: number): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    const name = t.artist.trim();
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

/** Search phrases for a mood, seeded by taste: per-artist, per-genre, then a
    generic backstop that always trails so cold-start still returns something. */
export function buildTasteQueries(input: {
  moodLabel: string;
  seedArtists: string[];
  seedGenres: string[];
}): string[] {
  const mood = input.moodLabel.trim();
  const queries: string[] = [];
  for (const a of input.seedArtists) queries.push(`${a} ${mood}`.trim());
  for (const g of input.seedGenres) queries.push(`${g} ${mood} music`.trim());
  queries.push(`${mood} music`.trim());
  return queries;
}

function normalizeArtist(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*-\s*topic\s*$/, "")
    .trim();
}

/**
 * Round-robin across per-query result lists (favouring earlier/higher-fit
 * queries), keeping the first occurrence of each videoId, dropping anything in
 * `excludeVideoIds` (already in the library) or by a `downrankArtists` channel
 * (she thumbs-downed them for this mood). Capped at `limit`.
 */
export function interleaveFresh(
  lists: YtSearchResult[][],
  opts: { limit: number; excludeVideoIds: Set<string>; downrankArtists: string[] },
): YtSearchResult[] {
  const down = new Set(opts.downrankArtists.map(normalizeArtist));
  const seen = new Set<string>();
  const out: YtSearchResult[] = [];
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let col = 0; col < maxLen && out.length < opts.limit; col++) {
    for (const list of lists) {
      if (out.length >= opts.limit) break;
      const r = list[col];
      if (!r) continue;
      if (seen.has(r.videoId) || opts.excludeVideoIds.has(r.videoId)) continue;
      if (down.has(normalizeArtist(r.uploader))) continue;
      seen.add(r.videoId);
      out.push(r);
    }
  }
  return out;
}
