import { type NextRequest, NextResponse } from "next/server";
import { createPendingDownload, runDownloadJob } from "@/server/services/yt-download";
import type { YtSearchResult } from "@/server/services/yt-service";

// Two-phase download (avoid Cloudflare's 100s edge timeout):
//
//   1. createPendingDownload — synchronously creates Track + YtCacheEntry,
//      returns trackId. ~50ms.
//   2. runDownloadJob — fired-and-forgotten. Runs in the Node process for
//      as long as yt-dlp needs (often 60-150s for big files / slow YT).
//      Client polls /api/yt-status/[ytVideoId] for completion.

function isValidResult(body: unknown): body is YtSearchResult {
  if (!body || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;
  return (
    typeof r.videoId === "string" &&
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

  if (!isValidResult(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const { trackId, cached } = await createPendingDownload(body);

    // Already on disk → tell the client to skip polling and play directly.
    if (cached) {
      return NextResponse.json({ trackId, status: "READY" });
    }

    // Phase 2 — DO NOT await. The Node process keeps it alive even after
    // this response is sent and the HTTP connection closes.
    void runDownloadJob(body, trackId);

    return NextResponse.json({ trackId, status: "DOWNLOADING" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mu] yt-download POST failed:", message);
    return NextResponse.json({ error: "create_failed", message }, { status: 500 });
  }
}
