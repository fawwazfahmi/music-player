// Cover art candidates for the per-track cover picker.
//
// The picker can only offer images that already exist somewhere. Two sources:
//
//   • Cover Art Archive, via a MusicBrainz recording search. These are real
//     square album covers — the fix for both "wrong cover" and "doesn't fit".
//   • The track's YouTube thumbnail, at a couple of resolutions. These are
//     16:9 and get centre-cropped into the app's square art slots, which is
//     exactly the "doesn't fit" complaint, so they are labelled as such.
//
// For obscure tracks CAA returns nothing and only the YouTube thumbnail
// remains. That is a real outcome, not a bug — the UI says so plainly.

import { searchRecording } from "@/server/services/musicbrainz";

/** Hosts a cover image may be fetched from. Without this allowlist,
    setTrackCover would fetch whatever URL a client sends, turning it into an
    SSRF probe against this machine's LAN and cloud metadata endpoints. */
const ALLOWED_COVER_HOSTS = new Set(["coverartarchive.org", "i.ytimg.com"]);

/**
 * True when `raw` is an https URL on an allowlisted image host, with no
 * embedded credentials.
 *
 * Note this validates the URL a *client* supplies. Cover Art Archive answers
 * with a redirect to archive.org, which fetch follows — that hop originates
 * from a host we trust, and is how the existing fetchCoverArt already works.
 */
export function isAllowedCoverHost(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return ALLOWED_COVER_HOSTS.has(u.hostname.toLowerCase());
}

export interface CoverCandidate {
  /** Stable key for React and for dedupe. */
  id: string;
  /** Small image for the picker grid. */
  thumbUrl: string;
  /** Full-size image stored when the user picks this one. */
  fullUrl: string;
  /** Short human label, e.g. the release title. */
  label: string;
  /** Extra context, e.g. "16:9 — will be cropped". */
  note?: string;
  /** Marks the image currently in use. */
  isCurrent?: boolean;
}

/** Most candidates to offer. Enough choice without an unbounded MB crawl. */
export const MAX_COVER_CANDIDATES = 8;

export function youtubeCandidates(ytVideoId: string): CoverCandidate[] {
  return [
    {
      id: `yt:maxres:${ytVideoId}`,
      thumbUrl: `https://i.ytimg.com/vi/${ytVideoId}/maxresdefault.jpg`,
      fullUrl: `https://i.ytimg.com/vi/${ytVideoId}/maxresdefault.jpg`,
      label: "YouTube thumbnail (high-res)",
      note: "16:9 — will be cropped to a square",
    },
    {
      id: `yt:hq:${ytVideoId}`,
      thumbUrl: `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
      fullUrl: `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`,
      label: "YouTube thumbnail",
      note: "16:9 — will be cropped to a square",
    },
  ];
}

/**
 * Dedupe by candidate id *and* by normalised label, preserving first
 * occurrence, then cap.
 *
 * The label check matters: MusicBrainz routinely returns the same album as
 * many distinct release mbids (one real track came back with five separate
 * "Visions" releases). Deduping on mbid alone let those five fill every slot
 * and pushed the YouTube fallbacks out of the list entirely.
 */
export function dedupeCandidates(
  candidates: CoverCandidate[],
  max = MAX_COVER_CANDIDATES,
): CoverCandidate[] {
  const seenId = new Set<string>();
  const seenLabel = new Set<string>();
  const out: CoverCandidate[] = [];
  for (const c of candidates) {
    if (seenId.has(c.id)) continue;
    const labelKey = `${c.id.split(":")[0]}|${c.label.trim().toLowerCase()}`;
    if (c.label && seenLabel.has(labelKey)) continue;
    seenId.add(c.id);
    if (c.label) seenLabel.add(labelKey);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** How long to wait when checking whether a candidate image actually exists. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * True if the image is really there.
 *
 * Cover Art Archive 404s for a large share of releases — MusicBrainz knowing
 * about a release says nothing about anyone having uploaded art for it. And
 * YouTube's maxresdefault is missing for plenty of older uploads. Probing
 * server-side keeps dead tiles out of the grid instead of letting them appear
 * and then disappear.
 */
export async function probeImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function coverArtArchiveCandidate(
  releaseMbid: string,
  releaseTitle: string,
): CoverCandidate {
  return {
    id: `caa:${releaseMbid}`,
    thumbUrl: `https://coverartarchive.org/release/${releaseMbid}/front-250`,
    fullUrl: `https://coverartarchive.org/release/${releaseMbid}/front-500`,
    label: releaseTitle || "Album cover",
  };
}

/**
 * Build the candidate list for a track. MusicBrainz failures are swallowed —
 * a dead upstream should still leave the YouTube thumbnails pickable rather
 * than break the dialog.
 */
export async function buildCoverCandidates(
  input: {
    artistName: string;
    title: string;
    ytVideoId?: string | null;
    currentHash?: string | null;
  },
  /** Injectable so tests don't hit the network. */
  probe: (url: string) => Promise<boolean> = probeImage,
): Promise<CoverCandidate[]> {
  // The already-stored cover is local; it needs no probing and always shows.
  const current: CoverCandidate[] = input.currentHash
    ? [
        {
          id: `current:${input.currentHash}`,
          thumbUrl: `/api/art/${input.currentHash}`,
          fullUrl: `/api/art/${input.currentHash}`,
          label: "Current cover",
          isCurrent: true,
        },
      ]
    : [];

  let caa: CoverCandidate[] = [];
  try {
    const recordings = await searchRecording(input.artistName, input.title);
    caa = recordings.flatMap((r) =>
      (r.releases ?? []).map((rel) => coverArtArchiveCandidate(rel.mbid, rel.title)),
    );
  } catch (err) {
    console.warn("[mu] cover candidates: MusicBrainz lookup failed", err);
  }
  caa = dedupeCandidates(caa, Number.MAX_SAFE_INTEGER);

  const yt = input.ytVideoId ? youtubeCandidates(input.ytVideoId) : [];

  // Probe everything remote at once, then drop what isn't actually there.
  const remote = [...caa, ...yt];
  const alive = await Promise.all(remote.map((c) => probe(c.thumbUrl)));
  const liveCaa = caa.filter((_, i) => alive[i]);
  const liveYt = yt.filter((_, i) => alive[caa.length + i]);

  // Reserve slots for the current cover and the YouTube fallbacks before
  // filling the rest with album art, so a long run of CAA releases can never
  // squeeze the fallbacks out — which is exactly what happened before.
  const reserved = current.length + liveYt.length;
  const caaSlots = Math.max(0, MAX_COVER_CANDIDATES - reserved);

  return [...current, ...liveCaa.slice(0, caaSlots), ...liveYt];
}
