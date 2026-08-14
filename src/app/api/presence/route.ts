import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setPresence } from "@/server/services/overlay-presence";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

// Write current now-playing. NOT in PUBLIC_PATHS, so the proxy middleware has
// already rejected anyone without a valid session before we run — only the
// logged-in Kyowave tab can push. Keyed by the listener's name cookie.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const c = await cookies();
  const raw = c.get(NAME_COOKIE_NAME)?.value ?? "";
  const name = isValidName(raw) ? raw : "default";
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  setPresence(name, {
    title: (body.title as string) ?? null,
    artist: (body.artist as string) ?? null,
    coverArtHash: (body.coverArtHash as string) ?? null,
    ytVideoId: (body.ytVideoId as string) ?? null,
    position: Number(body.position) || 0,
    duration: Number(body.duration) || 0,
    isPlaying: !!body.isPlaying,
  });
  return NextResponse.json({ ok: true });
}
