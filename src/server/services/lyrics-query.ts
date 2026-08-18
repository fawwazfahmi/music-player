// Build the ordered list of (artist, title) candidates to try against LRCLIB.
//
// The stored title is a YouTube title — "내가 제일 잘 나가(I AM THE BEST) M/V" —
// which LRCLIB never matches. But the romanized/English name in the parens
// ("I AM THE BEST") matches perfectly. So we generate cleaned candidates,
// most-likely-to-match first, and fall back to the raw title last.
import { stripTitleNoise, stripRedundantCjk } from "@/server/services/yt-title-parser";

const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힣]/;

export interface LyricsQuery {
  artist: string;
  title: string;
}

function pushUnique(list: string[], value: string): void {
  const v = value.trim();
  if (v.length > 0 && !list.includes(v)) list.push(v);
}

/** Ordered artist/title candidates for a lyrics lookup, cleaned → raw. */
export function buildLyricsQueries(artist: string, title: string): LyricsQuery[] {
  const cleanArtist = stripRedundantCjk(artist).trim() || artist.trim();
  const base = stripTitleNoise(title); // drops "M/V", "(Official Video)", …

  const titles: string[] = [];

  // A CJK title usually carries its official romanized/English name in parens —
  // that's the string LRCLIB indexes on, so try it first.
  if (CJK_RE.test(base)) {
    const paren = base.match(/\(([^)]*[A-Za-z][^)]*)\)/);
    if (paren) pushUnique(titles, paren[1]!);
  }

  // The title with any parenthetical dropped and native script stripped
  // ("aespa 에스파 Song" → "Song"; "춤 (CHOOM)" → "춤").
  const noParen = base.replace(/\([^)]*\)/g, " ").replace(/\s{2,}/g, " ").trim();
  pushUnique(titles, noParen);

  // The de-noised title as-is, then the untouched raw title.
  pushUnique(titles, base);
  pushUnique(titles, title);

  return titles.map((t) => ({ artist: cleanArtist, title: t }));
}
