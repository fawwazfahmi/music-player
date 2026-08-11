import { type NextRequest, NextResponse } from "next/server";
import { enqueueSelected } from "@/server/services/yt-download";
import type { YtSearchResult } from "@/server/services/yt-service";

// POST /api/yt-playlist/enqueue { videos: YtSearchResult[] }
//
// Takes the selection the user kept in the picker and starts downloading it.
// Does NOT touch the play queue — downloads land in the library and are
// surfaced on the Downloads screen, so starting a batch never interrupts
// playback.
//
// The entries are echoed back from our own /preview response rather than
// re-fetched server-side. That trusts the client with data it received from
// us moments earlier; acceptable for a two-person password-gated app.

/** Upper bound on a single request. A mix preview tops out at 40; a long
    curated playlist could be far bigger, and we'd rather reject loudly than
    silently truncate someone's selection. */
const MAX_SELECTION = 500;

function isVideo(v: unknown): v is YtSearchResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.videoId === "string" &&
    r.videoId.length > 0 &&
    typeof r.title === "string" &&
    typeof r.uploader === "string" &&
    typeof r.duration === "number"
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const videos = (body as { videos?: unknown })?.videos;
  if (!Array.isArray(videos) || videos.length === 0) {
    return NextResponse.json({ error: "no_selection" }, { status: 400 });
  }
  if (videos.length > MAX_SELECTION) {
    return NextResponse.json(
      { error: "selection_too_large", message: `Select at most ${MAX_SELECTION} songs.` },
      { status: 400 },
    );
  }
  if (!videos.every(isVideo)) {
    return NextResponse.json({ error: "invalid_video" }, { status: 400 });
  }

  try {
    const result = await enqueueSelected(videos);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mu] /api/yt-playlist/enqueue failed:", message);
    return NextResponse.json({ error: "enqueue_failed", message }, { status: 500 });
  }
}
