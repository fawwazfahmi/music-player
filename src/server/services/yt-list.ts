// YouTube list classification + read-only preview.
//
// A "?list=" URL is two completely different things wearing the same shape,
// and the distinction drives everything downstream:
//
//   RD… / RDMM… / RDAMVM… / RDEM…  — a Mix. An *infinite algorithmic radio*
//     seeded on one video. Fetching it unbounded makes yt-dlp walk
//     continuation pages indefinitely; three identical calls to the same Mix
//     URL returned 366 / 1769 / 366 entries, and the 1769 case was only 372
//     unique videos looped ~5×. Only the head of the stream is genuinely
//     related to the seed — past roughly 20 entries it drifts into generic
//     recommendations. So: bound it, dedupe it, and pre-check only the head.
//
//   PL… / OLAK5uy_… / UU…  — a curated playlist or album. Finite and stable;
//     the same URL fetched twice returned 13 entries in identical order with
//     no duplicates. So: fetch it whole, keep its order, and never dedupe —
//     a real playlist may legitimately repeat a track.
//
// Nothing in this module touches the database. Preview is read-only by
// construction; enqueueing is a separate, explicit user action.

import { fetchPlaylist, type YtSearchResult } from "@/server/services/yt-service";

export type ListKind = "mix" | "playlist";

export interface ListClassification {
  kind: ListKind;
  listId: string;
}

/** Auto-generated radio list-id prefixes. All of them start with "RD"; the
    longer forms are listed for documentation value. */
const MIX_PREFIXES = ["RDMM", "RDAMVM", "RDEM", "RD"] as const;

/** Only these hosts are ever handed to yt-dlp. yt-dlp happily fetches
    hundreds of sites (and arbitrary hosts), so an unvalidated URL from the
    client would let anyone point the server's fetcher at an internal
    address. */
const YT_HOSTS = /^(?:www\.|m\.|music\.)?youtube\.com$|^youtu\.be$/i;

export function classifyListUrl(raw: string): ListClassification | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!YT_HOSTS.test(u.hostname)) return null;
  const listId = u.searchParams.get("list");
  if (!listId) return null;
  const kind: ListKind = MIX_PREFIXES.some((p) => listId.startsWith(p))
    ? "mix"
    : "playlist";
  return { kind, listId };
}

/** How deep to let yt-dlp walk a mix. Past this the list is drift anyway,
    and leaving it unbounded is what produced the 1769-entry runaway. */
export const MIX_FETCH_LIMIT = 40;

/** How many of a mix's entries to pre-check for the user. Heuristic, derived
    from observing where a mix stops resembling its seed — not a constant
    YouTube publishes. Being wrong costs the user a couple of clicks. */
export const MIX_DEFAULT_CHECKED = 20;

export interface ListPreview {
  kind: ListKind;
  listId: string;
  title: string;
  tracks: YtSearchResult[];
  /** The first N tracks the UI should tick by default. */
  defaultCheckedCount: number;
}

export interface PreviewListOptions {
  cookiePath?: string | null;
}

function dedupeByVideoId(tracks: YtSearchResult[]): YtSearchResult[] {
  const seen = new Set<string>();
  const out: YtSearchResult[] = [];
  for (const t of tracks) {
    if (seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    out.push(t);
  }
  return out;
}

/**
 * Read-only. Resolves a list URL to the videos it contains. Creates no Track
 * rows, no YtCacheEntry rows, and starts no downloads — that only happens
 * once the user has pruned the list and explicitly enqueued it.
 */
export async function previewList(
  url: string,
  opts: PreviewListOptions = {},
): Promise<ListPreview> {
  const classified = classifyListUrl(url);
  if (!classified) {
    throw new Error("Not a YouTube playlist or mix URL");
  }
  const { kind, listId } = classified;

  const { title, entries } = await fetchPlaylist(url, {
    playlistEnd: kind === "mix" ? MIX_FETCH_LIMIT : undefined,
    cookiePath: opts.cookiePath,
  });

  const tracks = kind === "mix" ? dedupeByVideoId(entries) : entries;
  const defaultCheckedCount =
    kind === "mix" ? Math.min(MIX_DEFAULT_CHECKED, tracks.length) : tracks.length;

  return { kind, listId, title, tracks, defaultCheckedCount };
}
