import { type NextRequest, NextResponse } from "next/server";
import { previewList } from "@/server/services/yt-list";
import {
  identityFromRequest,
  isStaleError,
  markStale,
  readCookiePath,
  scrubCookiePaths,
} from "@/server/services/yt-cookies";

// POST /api/yt-playlist/preview { url }
//
// Read-only. Resolves a YouTube playlist / mix URL to the videos it contains
// so the user can prune the list before anything is downloaded. Creates no
// Track rows, no YtCacheEntry rows, and starts no downloads.
//
// Mixes are bounded and deduped; curated playlists come back whole and in
// order. See yt-list.ts for why those differ.

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string" || !url.startsWith("http")) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  const name = identityFromRequest(req);
  const cookiePath = name ? await readCookiePath(name) : null;

  try {
    let preview;
    try {
      preview = await previewList(url, { cookiePath });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Expired jar: flag it so Settings can prompt a reconnect, then fall
      // back to an anonymous fetch. A generic list beats a hard failure.
      if (cookiePath && name && isStaleError(raw)) {
        await markStale(name);
        console.warn(`[mu] YouTube cookies for ${name} look expired — falling back to anonymous`);
        preview = await previewList(url, { cookiePath: null });
      } else {
        throw err;
      }
    }

    if (preview.tracks.length === 0) {
      return NextResponse.json({ error: "empty_list" }, { status: 422 });
    }
    return NextResponse.json(
      { ...preview, usedCookies: cookiePath !== null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = scrubCookiePaths(err instanceof Error ? err.message : String(err));
    if (/not a youtube/i.test(message)) {
      return NextResponse.json({ error: "not_a_playlist", message }, { status: 400 });
    }
    console.error("[mu] /api/yt-playlist/preview failed:", message);
    return NextResponse.json({ error: "preview_failed", message }, { status: 500 });
  }
}
