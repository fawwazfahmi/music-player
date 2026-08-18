import { NextResponse } from "next/server";
import { getPresence } from "@/server/services/overlay-presence";
import { db } from "@/server/db";
import { resolveTrackCoverHash } from "@/lib/cover-url";

// Public, read-only now-playing for the OBS overlay (no login cookie in a
// browser source — allow-listed in src/proxy.ts). Only exposes the current
// track. Optionally gate with OVERLAY_TOKEN in .env + ?key=<token>.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

/** Changes on every server start, i.e. every deploy.
 *
 * An OBS browser source caches the page and will happily render months-old CSS
 * until someone right-clicks "Refresh cache" — which is not something you can
 * ask for mid-broadcast. The overlay already polls this endpoint every second,
 * so it can notice a new generation and reload itself. KyoTips solves the same
 * problem by pushing a `reload` frame down its SSE stream. */
const GENERATION = String(Date.now());

/** Fill in art the pushing tab did not send.
 *
 * Presence is only as good as the QueueTrack the player tab holds, and a queue
 * restored from localStorage can predate whatever fix added a field — the tab
 * would have to be reloaded AND the queue rebuilt before art reappeared, which
 * is not something to ask of someone mid-stream. The art is in the database
 * either way, so resolve it here and the overlay stops depending on the client
 * having got it right.
 *
 * Only a fallback: art the tab did send always wins, so a per-track cover
 * chosen in the picker is never overridden by a title match.
 */
async function resolveArt(p: {
  title: string | null;
  coverArtHash: string | null;
  ytVideoId: string | null;
}): Promise<{ coverArtHash: string | null; ytVideoId: string | null }> {
  if (p.coverArtHash || p.ytVideoId || !p.title) {
    return { coverArtHash: p.coverArtHash, ytVideoId: p.ytVideoId };
  }
  try {
    // Titles do not always match exactly. The library stores cleaned metadata
    // ("After LIKE") while a queue built from a YouTube pick carries the raw
    // title ("IVE 아이브 'After LIKE' MV"), so an equality check misses. Try, in
    // order: an exact hit, then the longest library title *contained* in the
    // pushed one, then a trigram match — the same similarity() search used by
    // the library search. Longest-first matters: it stops a short generic title
    // from claiming a track that a more specific one should own.
    const rows = await db.$queryRaw<
      { coverArtHash: string | null; ytVideoId: string | null; albumCoverArtHash: string | null }[]
    >`
      SELECT t."coverArtHash", t."ytVideoId", al."coverArtHash" AS "albumCoverArtHash"
      FROM "Track" t
      LEFT JOIN "Album" al ON t."albumId" = al.id
      WHERE t.title = ${p.title}
         OR (length(t.title) >= 5 AND ${p.title} ILIKE '%' || t.title || '%')
         OR similarity(t.title, ${p.title}) > 0.35
      ORDER BY (t.title = ${p.title}) DESC,
               (${p.title} ILIKE '%' || t.title || '%') DESC,
               length(t.title) DESC,
               similarity(t.title, ${p.title}) DESC,
               t."inLibrary" DESC
      LIMIT 1
    `;
    const t = rows[0];
    if (!t) return { coverArtHash: null, ytVideoId: null };
    return {
      coverArtHash: resolveTrackCoverHash({
        trackCoverArtHash: t.coverArtHash,
        albumCoverArtHash: t.albumCoverArtHash,
      }),
      ytVideoId: t.ytVideoId ?? null,
    };
  } catch {
    // The overlay must keep rendering even if the database is unreachable.
    return { coverArtHash: null, ytVideoId: null };
  }
}

export async function GET(req: Request) {
  const token = process.env.OVERLAY_TOKEN;
  const url = new URL(req.url);
  if (token && url.searchParams.get("key") !== token) {
    return NextResponse.json({ found: false }, { status: 401, headers: HEADERS });
  }
  const p = getPresence(url.searchParams.get("who"));
  if (!p) return NextResponse.json({ found: false }, { headers: HEADERS });
  const art = await resolveArt(p);
  return NextResponse.json(
    {
      found: true,
      gen: GENERATION,
      playing: p.isPlaying,
      title: p.title,
      artist: p.artist,
      coverArtHash: art.coverArtHash,
      ytVideoId: art.ytVideoId,
      position: p.position,
      duration: p.duration,
      ageMs: Date.now() - p.updatedAt,
    },
    { headers: HEADERS },
  );
}
