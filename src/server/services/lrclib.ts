// LRCLIB is a free, open lyrics database with timestamped (LRC) and plain lyrics.
// https://lrclib.net/docs
import { buildLyricsQueries } from "@/server/services/lyrics-query";

const BASE = "https://lrclib.net/api";
const UA = "Kyowave/1.0 (personal music player)";

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

/** From a /api/search result list, pick the entry that actually has lyrics and
    (when we know the track duration) is within a few seconds of it — LRCLIB
    search is fuzzy and will happily return a same-title different-song. Pure so
    the duration guard is unit-testable. */
export function pickBestMatch(
  results: LrcLibResponse[],
  durationSec?: number,
): LrcLibResponse | null {
  const withLyrics = results.filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental);
  if (withLyrics.length === 0) return null;
  if (!durationSec || durationSec <= 0) return withLyrics[0]!;

  const TOL = 4; // seconds
  const inTol = withLyrics
    .filter((r) => typeof r.duration === "number" && Math.abs(r.duration - durationSec) <= TOL)
    // Prefer synced, then closest duration.
    .sort((a, b) => {
      const synced = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
      if (synced !== 0) return synced;
      return Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec);
    });
  return inTol[0] ?? null;
}

function toResult(r: LrcLibResponse): LrcLibResult {
  return {
    syncedLyrics: r.syncedLyrics ?? null,
    plainLyrics: r.plainLyrics ?? null,
    instrumental: !!r.instrumental,
  };
}

function hasLyrics(r: LrcLibResult): boolean {
  return !!(r.syncedLyrics || r.plainLyrics || r.instrumental);
}

async function getExact(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<LrcLibResult | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  // Deliberately omit album_name — our YT tracks carry a junk "YouTube" album
  // that would only break the exact match.
  if (durationSec && durationSec > 0) params.set("duration", String(durationSec));
  const res = await fetch(`${BASE}/get?${params.toString()}`, { headers: { "User-Agent": UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return toResult((await res.json()) as LrcLibResponse);
}

async function search(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<LrcLibResult | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  const res = await fetch(`${BASE}/search?${params.toString()}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as LrcLibResponse[];
  const best = pickBestMatch(Array.isArray(data) ? data : [], durationSec);
  return best ? toResult(best) : null;
}

/**
 * Look up lyrics on LRCLIB. Tries cleaned title candidates (romanized/English
 * name first for CJK titles), each via exact /api/get then fuzzy /api/search,
 * and returns the first candidate that yields real lyrics.
 */
export async function fetchLyrics(
  artist: string,
  title: string,
  _album?: string,
  durationSec?: number,
): Promise<LrcLibResult | null> {
  const queries = buildLyricsQueries(artist, title);
  for (const q of queries) {
    const exact = await getExact(q.artist, q.title, durationSec).catch(() => null);
    if (exact && hasLyrics(exact)) return exact;
    const found = await search(q.artist, q.title, durationSec).catch(() => null);
    if (found && hasLyrics(found)) return found;
  }
  return null;
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
