import { type NextRequest, NextResponse } from "next/server";
import { enqueuePlaylist } from "@/server/services/yt-download";
import { isPlaylistUrl } from "@/server/services/yt-service";

// POST /api/yt-playlist { url }
//
// Pulls the video list for a YT playlist / mix, creates Track + YtCacheEntry
// rows for every video, and fires a sequential background download chain.
// Returns the list of created tracks (with trackId, title, ytVideoId, …) so
// the client can append them to the queue right away. Audio for the first
// track might not be on disk yet by the time the user hits Play — the audio
// engine's retry-on-error loop catches up once yt-dlp finishes that video.

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
  if (!isPlaylistUrl(url)) {
    return NextResponse.json({ error: "not_a_playlist" }, { status: 400 });
  }
  try {
    const result = await enqueuePlaylist(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mu] /api/yt-playlist failed:", message);
    return NextResponse.json({ error: "playlist_failed", message }, { status: 500 });
  }
}
