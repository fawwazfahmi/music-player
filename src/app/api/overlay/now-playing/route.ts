import { NextResponse } from "next/server";
import { getPresence } from "@/server/services/overlay-presence";

// Public, read-only now-playing for the OBS overlay (no login cookie in a
// browser source — allow-listed in src/proxy.ts). Only exposes the current
// track. Optionally gate with OVERLAY_TOKEN in .env + ?key=<token>.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function GET(req: Request) {
  const token = process.env.OVERLAY_TOKEN;
  const url = new URL(req.url);
  if (token && url.searchParams.get("key") !== token) {
    return NextResponse.json({ found: false }, { status: 401, headers: HEADERS });
  }
  const p = getPresence(url.searchParams.get("who"));
  if (!p) return NextResponse.json({ found: false }, { headers: HEADERS });
  return NextResponse.json(
    {
      found: true,
      playing: p.isPlaying,
      title: p.title,
      artist: p.artist,
      coverArtHash: p.coverArtHash,
      ytVideoId: p.ytVideoId,
      position: p.position,
      duration: p.duration,
      ageMs: Date.now() - p.updatedAt,
    },
    { headers: HEADERS },
  );
}
