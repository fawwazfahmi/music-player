import PQueue from "p-queue";
import { env } from "@/lib/env";

const BASE = "https://musicbrainz.org/ws/2";

// 1 req/sec per MB etiquette policy. interval=1100ms for a tiny safety margin.
const queue = new PQueue({ concurrency: 1, interval: 1100, intervalCap: 1 });

export interface RecordingResult {
  mbid: string;
  score: number;
  title: string;
  artistName: string;
  artistMbid?: string;
  releaseMbid?: string;
  releaseTitle?: string;
}

export interface ArtistInfo {
  name: string;
  bio?: string;
}

interface MBRecording {
  id: string;
  score?: number;
  title: string;
  "artist-credit"?: { artist: { id: string; name: string } }[];
  releases?: { id: string; title: string }[];
}

async function mbFetch(pathName: string, search: Record<string, string>): Promise<Response> {
  const params = new URLSearchParams({ ...search, fmt: "json" });
  const url = `${BASE}${pathName}?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT },
    });
    if (res.ok) return res;
    if (res.status === 503 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`MusicBrainz ${res.status}: ${url}`);
  }
  throw new Error(`MusicBrainz exhausted retries: ${url}`);
}

export async function searchRecording(artist: string, title: string): Promise<RecordingResult[]> {
  return queue.add(async () => {
    const q = `artist:"${artist}" AND recording:"${title}"`;
    const res = await mbFetch("/recording", { query: q, limit: "5" });
    const data = (await res.json()) as { recordings?: MBRecording[] };
    return (data.recordings ?? []).map((r) => {
      const credit = r["artist-credit"]?.[0]?.artist;
      const release = r.releases?.[0];
      return {
        mbid: r.id,
        score: r.score ?? 0,
        title: r.title,
        artistName: credit?.name ?? "Unknown",
        artistMbid: credit?.id,
        releaseMbid: release?.id,
        releaseTitle: release?.title,
      };
    });
  }) as Promise<RecordingResult[]>;
}

export async function getArtist(mbid: string): Promise<ArtistInfo> {
  return queue.add(async () => {
    const res = await mbFetch(`/artist/${mbid}`, {});
    const data = (await res.json()) as {
      id: string;
      name: string;
      annotation?: string;
      disambiguation?: string;
      type?: string;
      country?: string;
      "life-span"?: { begin?: string; end?: string };
    };
    // MB annotations are usually empty; build a short bio from structured fields.
    const bio =
      data.annotation?.trim() ||
      buildShortBio(data.disambiguation, data.type, data.country, data["life-span"]?.begin);
    return { name: data.name, bio };
  }) as Promise<ArtistInfo>;
}

function buildShortBio(
  disambiguation: string | undefined,
  type: string | undefined,
  country: string | undefined,
  begin: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (disambiguation && disambiguation.trim().length > 0) parts.push(disambiguation.trim());
  const meta: string[] = [];
  if (country) meta.push(country);
  if (type) meta.push(type.toLowerCase());
  if (begin) meta.push(`since ${begin.slice(0, 4)}`);
  if (meta.length > 0) parts.push(meta.join(" · "));
  return parts.length > 0 ? parts.join(" — ") : undefined;
}
