// Grounded title/artist cleaning helpers — pure text, no guessing.

// Version markers we KEEP (she wants to tell versions apart).
const KEEP =
  /\b(slow(?:ed)?|reverb(?:ed)?|sped\s*up|speed\s*up|nightcore|remix|cover|acoustic|instrumental|live|extended|edit|mix|version|demo|8d|bass\s*boost(?:ed)?|mashup)\b/i;
// Pure noise inside brackets we DROP.
const NOISE =
  /\b(official|lyric|lyrics|audio|video|hd|hq|4k|8k|visuali[sz]er|m\/?v|full\s*video|music\s*video)\b/i;

/** Fullwidth → ASCII, and collapse "S l o w e d" spacing into "Slowed". */
export function normalizeWidth(input: string): string {
  let s = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) s += String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) s += " ";
    else s += ch;
  }
  // Merge runs of ≥2 consecutive single-letter/digit tokens ("H o m e" → "Home").
  const tokens = s.split(/\s+/);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (/^[A-Za-z0-9]$/.test(t)) run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Clean a title: fix width/spacing, drop noise brackets, KEEP version markers. */
export function tidyTitle(input: string): string {
  let s = normalizeWidth(input);
  s = s.replace(/[([][^)\]]*[)\]]/g, (g) => {
    const inner = g.slice(1, -1);
    if (KEEP.test(inner)) return g; // keep slowed/reverb/remix/…
    if (NOISE.test(inner)) return ""; // drop official/lyrics/video/…
    return g; // unknown → keep (conservative)
  });
  return s
    .replace(/\s{2,}/g, " ")
    .replace(/\s*-\s*$/, "")
    .trim();
}

export interface ParsedCredits {
  title: string;
  artists: string[];
  album: string | null;
}

/** Parse YouTube's auto "Provided to YouTube by … / Title · Artist · Artist /
    Album" credit block from a description. Null when absent. */
export function parseYtMusicDescription(desc: string): ParsedCredits | null {
  if (!desc || !/provided to youtube by/i.test(desc)) return null;
  const lines = desc
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const idx = lines.findIndex((l) => l.includes(" · "));
  if (idx === -1) return null;
  const parts = lines[idx]!.split(" · ").map((p) => p.trim()).filter(Boolean);
  const [title, ...artists] = parts;
  if (!title || artists.length === 0) return null;
  const next = lines[idx + 1];
  const album = next && !/^[℗©]|^released on/i.test(next) ? next : null;
  return { title, artists, album };
}
