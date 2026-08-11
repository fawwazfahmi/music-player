import { NextResponse } from "next/server";
import { retryDownload } from "@/server/services/yt-download";

// POST /api/downloads/[videoId]/retry — re-run a failed yt-dlp job.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  try {
    await retryDownload(videoId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "retry_failed", message }, { status: 400 });
  }
}
