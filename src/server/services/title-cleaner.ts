import { ollamaGenerateJson } from "@/server/services/mood-llm";

const MAX_ARTISTS = 3;

export interface CleanInput {
  title: string;
  artist: string;
  album: string;
}

export interface CleanResult {
  title: string;
  artists: string[];
}

/** Ask the local LLM to clean a re-upload's title and recover the real
    artist(s). Conservative: returns null when nothing should change or the
    output is unusable, so the caller only acts on genuine improvements.
    Keeps version markers (slowed/reverb/remix). Never throws. */
export async function cleanTrackMeta(input: CleanInput): Promise<CleanResult | null> {
  const prompt =
    `You clean up music track metadata from YouTube re-uploads. Given the raw ` +
    `title, uploader, and album, return the CLEAN song title and the REAL ` +
    `artist(s). Rules:\n` +
    `- Fix odd letter-spacing/fonts: "H o m e" → "Home".\n` +
    `- Remove noise: channel suffixes like "- Topic", "lyrics", "official video", ` +
    `"HD", and stray sentences that aren't the title.\n` +
    `- KEEP version markers in the title: (Slowed), (Reverb), (Slowed & Reverbed), ` +
    `(Remix), (Sped Up), (Cover), (Acoustic), etc.\n` +
    `- The artist is the performing/original artist, NOT the uploader or a lyrics ` +
    `channel. "X - Topic" → artist "X".\n` +
    `- If it's a remix/mashup of multiple artists' songs, list every original artist.\n` +
    `- If the raw title is already clean, set changed=false and echo it.\n` +
    `- Be conservative: only change what's clearly messy.\n` +
    `Respond ONLY JSON: {"title": "...", "artists": ["..."], "changed": true|false}.\n` +
    `Raw title: "${input.title}"\nUploader: "${input.artist}"\nAlbum: "${input.album}"`;

  const parsed = await ollamaGenerateJson<{
    title?: unknown;
    artists?: unknown;
    changed?: unknown;
  }>(prompt);
  if (!parsed || parsed.changed === false) return null;

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const artists = Array.isArray(parsed.artists)
    ? Array.from(
        new Set(
          parsed.artists
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter((a) => a.length > 0),
        ),
      ).slice(0, MAX_ARTISTS)
    : [];

  if (!title || artists.length === 0) return null;
  return { title, artists };
}
