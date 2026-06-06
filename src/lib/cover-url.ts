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
