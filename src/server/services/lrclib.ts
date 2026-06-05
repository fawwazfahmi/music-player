// LRCLIB is a free, open lyrics database with timestamped (LRC) and plain lyrics.
// https://lrclib.net/docs

const BASE = "https://lrclib.net/api";

export interface LrcLibResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

interface LrcLibResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export async function fetchLyrics(
  artist: string,
  title: string,
  album?: string,
  durationSec?: number,
): Promise<LrcLibResult | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
  });
  if (album) params.set("album_name", album);
  if (durationSec && durationSec > 0) params.set("duration", String(durationSec));

  const res = await fetch(`${BASE}/get?${params.toString()}`, {
    headers: {
      "User-Agent": "MusicUniverse/1.0 (personal music player)",
    },
  });
  if (res.status === 404) {
    return searchLyrics(artist, title);
  }
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);

  const data = (await res.json()) as LrcLibResponse;
  return {
    syncedLyrics: data.syncedLyrics ?? null,
    plainLyrics: data.plainLyrics ?? null,
    instrumental: !!data.instrumental,
  };
}

async function searchLyrics(artist: string, title: string): Promise<LrcLibResult | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  const res = await fetch(`${BASE}/search?${params.toString()}`, {
    headers: { "User-Agent": "MusicUniverse/1.0 (personal music player)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as LrcLibResponse[];
  const top = data[0];
  if (!top) return null;
  return {
    syncedLyrics: top.syncedLyrics ?? null,
    plainLyrics: top.plainLyrics ?? null,
    instrumental: !!top.instrumental,
  };
}

// Parse LRC format "[mm:ss.xx]text" into ordered { time, text } pairs.
export interface LyricLine {
  time: number;
  text: string;
}

const LRC_TIME_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseSyncedLyrics(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const text = rawLine.replace(LRC_TIME_RE, "").trim();
    let m: RegExpExecArray | null;
    LRC_TIME_RE.lastIndex = 0;
    while ((m = LRC_TIME_RE.exec(rawLine)) !== null) {
      const min = parseInt(m[1]!, 10);
      const sec = parseInt(m[2]!, 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      out.push({ time: min * 60 + sec + frac, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
