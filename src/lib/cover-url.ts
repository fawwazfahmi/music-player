// Resolve a cover-art URL for a track. Priority:
//   1. /api/art/<hash> — MusicBrainz / Cover Art Archive image we already
//      downloaded and SHA-keyed.
//   2. https://i.ytimg.com/vi/<ytVideoId>/hqdefault.jpg — fallback for YT
//      tracks whose album never matched MB. Hands the user a real image
//      instead of the grey gradient placeholder.
//
// Returns null when we have neither — the caller should render a
// placeholder/icon in that case.
//
// Note: hqdefault is the most reliably-present size (always exists, even
// for old uploads). maxresdefault is higher quality but 404s on a lot of
// videos so we don't bother.

export function coverUrl(
  hash: string | null | undefined,
  ytVideoId?: string | null,
): string | null {
  if (hash) return `/api/art/${hash}`;
  if (ytVideoId) return `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;
  return null;
}

export interface CoverHashSources {
  /** Per-track override chosen by hand in the cover picker. Wins outright. */
  trackCoverArtHash?: string | null;
  /** The album's art, from MusicBrainz / Cover Art Archive. */
  albumCoverArtHash?: string | null;
  /** Legacy field name. Existing call sites pass album-level art under this
      name, so it ranks alongside albumCoverArtHash, never above an override. */
  legacyCoverArtHash?: string | null;
}

/**
 * Pick which stored art hash a track should display.
 *
 * A per-track override exists because every YouTube download by one artist is
 * upserted into a single shared "YouTube" album — album art therefore cannot
 * express "this one song's cover is wrong".
 *
 * Empty strings are treated as absent; a hash is always a 64-char sha256.
 */
export function resolveTrackCoverHash(sources: CoverHashSources): string | null {
  return (
    sources.trackCoverArtHash ||
    sources.albumCoverArtHash ||
    sources.legacyCoverArtHash ||
    null
  );
}
