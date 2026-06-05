// Parse a YouTube video title into { artist, title }.
//
// YouTube titles for music are usually one of:
//   "Artist - Title"                          → most common
//   "Artist – Title"   /  "Artist — Title"    → en/em dash
//   "Artist · Title"                          → middle dot (Auto-generated)
//   "Artist | Title"                          → pipe
//   "@artist - Title (Lyrics)"                → @ prefix + parenthetical
//   "Artist - Title [Official Music Video]"   → bracketed tag
//
// If no separator is found, fall back to (uploader, clean(title)).

const SEPARATORS = [" - ", " – ", " — ", " · ", " | "];

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

  return { artist: uploader.trim() || "Unknown", title: cleanTitleTags(trimmed) };
}
