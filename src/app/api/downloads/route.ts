import { NextResponse } from "next/server";
import { listDownloads } from "@/server/services/yt-download";

// GET /api/downloads
//
// Active + failed downloads, plus anything completed in the last 24h. Read
// from YtCacheEntry rather than any client-side store, so the Downloads
// screen survives a reload and shows work started from any device.

export async function GET() {
  try {
    const rows = await listDownloads();
    return NextResponse.json(
      { downloads: rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mu] /api/downloads failed:", message);
    return NextResponse.json({ error: "list_failed", message }, { status: 500 });
  }
}
