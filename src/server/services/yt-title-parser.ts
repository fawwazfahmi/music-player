// Parse a YouTube video title into { artist, title }.
//
// YouTube titles for music are usually one of:
//   "Artist - Title"                          → most common
//   "Artist – Title"   /  "Artist — Title"    → en/em dash
//   "Artist · Title"                          → middle dot (Auto-generated)
//   "Artist | Title"                          → pipe
//   "@artist - Title (Lyrics)"                → @ prefix + parenthetical
//   "Artist - Title [Official Music Video]"   → bracketed tag
//   "ARTIST “Song” M/V"                        → K-pop / MV quote format
//
// If nothing matches, fall back to (uploader, clean(title)).

const SEPARATORS = [" - ", " – ", " — ", " · ", " | "];

// K-pop / MV pattern: an artist prefix, then the song wrapped in quotes, e.g.
//   TWICE “Strategy” M/V   ·   aespa 'Armageddon' MV
// The uploader on these is a label ("JYP Entertainment"), so the quoted title
// is the only real artist signal. The artist class excludes "(" / "[" / quotes
// so a quote INSIDE a parenthetical — e.g. Memory (From "Insomnia" Album) —
// doesn't match (there's a "(" before the quote → no clean artist prefix).
export const QUOTED_RE = /^([^("'“‘[]+?)\s*['"“‘]([^'"”’]+?)['"”’]/;

// Parenthetical tags that should be stripped from the title (case-insensitive).
// Matches any (...) or [...] block that CONTAINS one of these keywords anywhere
// inside. Catches "(Official Video)", "(Bridge Demo)", "(Acoustic Version)",
// "(Live at Royal Albert Hall)", "(feat. Drake)", etc.
const TAG_RE =
  /\s*[(\[][^)\]]*(?:official|lyrics?|audio|hd|hq|4k|8k|live|acoustic|remix|cover|mv|m\/v|visualizer|extended|radio|clean|explicit|feat\.?|ft\.?|demo|version|edit|mix|instrumental|sped\s*up|slowed|reverb|stripped|piano|bonus|deluxe)[^)\]]*[)\]]\s*/gi;

// Symbols like ☆ ♪ ★ ✨ etc that sometimes decorate titles — strip in aggressive mode
const DECORATION_RE = /[☀-➿✀-➿⌀-⏿⬀-⯿]+/g;

export function cleanTitleTags(title: string): string {
  return title.replace(TAG_RE, " ").replace(/\s{2,}/g, " ").trim();
}

// Hangul, Kana, and CJK ideograph ranges. K-pop MV titles give the artist
// bilingually ("aespa 에스파", "IVE 아이브"); when a Latin name is present we keep
// it and drop the native duplicate. A purely non-Latin name is left untouched.
const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힣]/g;

export function stripRedundantCjk(name: string): string {
  if (!/[A-Za-z]/.test(name)) return name.trim();
  const stripped = name.replace(CJK_RE, " ").replace(/\s{2,}/g, " ").trim();
  return stripped.length > 0 ? stripped : name.trim();
}

/** Insert spaces between lowercase→uppercase transitions: "BillieEilish" → "Billie Eilish". */
export function splitCamelCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Aggressive variant: also strips any remaining parentheticals + symbol decorations. */
export function aggressivelyCleanTitle(title: string): string {
  return cleanTitleTags(title)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(DECORATION_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface ParsedTitle {
  artist: string;
  title: string;
}

export function parseYtTitle(rawTitle: string, uploader: string): ParsedTitle {
  const trimmed = rawTitle.trim();

  for (const sep of SEPARATORS) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0 && idx < trimmed.length - sep.length) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + sep.length).trim();
      if (left.length > 0 && right.length > 0) {
        const artist = left.replace(/^@/, "").trim();
        return { artist, title: cleanTitleTags(right) };
      }
    }
  }

  const quoted = trimmed.match(QUOTED_RE);
  if (quoted) {
    const artist = stripRedundantCjk(quoted[1]!.replace(/^@/, "").trim());
    const title = cleanTitleTags(quoted[2]!).trim();
    if (artist.length > 0 && title.length > 0) return { artist, title };
  }

  return { artist: uploader.trim() || "Unknown", title: cleanTitleTags(trimmed) };
}
