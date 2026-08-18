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
    const t = await db.track.findFirst({
      where: { title: p.title },
      select: {
        coverArtHash: true,
        ytVideoId: true,
        album: { select: { coverArtHash: true } },
      },
      // Prefer a real library track over an ephemeral pick with the same title.
      orderBy: { inLibrary: "desc" },
    });
    if (!t) return { coverArtHash: null, ytVideoId: null };
    return {
      coverArtHash: resolveTrackCoverHash({
        trackCoverArtHash: t.coverArtHash,
        albumCoverArtHash: t.album?.coverArtHash,
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
