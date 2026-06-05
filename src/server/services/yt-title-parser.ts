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
// Single regex covers both () and [] wrappers.
const TAG_RE =
  /\s*[(\[]\s*(?:official\s*(?:music\s*)?video|official\s*audio|official\s*lyric\s*video|official|lyrics?|audio\s*only|audio|hd|hq|4k|8k|live|acoustic|remix|cover|mv|m\/v|visualizer|extended|radio\s*edit|clean|explicit|feat\.?\s*[^)\]]+|ft\.?\s*[^)\]]+)\s*[)\]]\s*/gi;

export function cleanTitleTags(title: string): string {
  return title.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim();
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
