import { type NextRequest, NextResponse } from "next/server";
import { runYtDownload } from "@/server/services/yt-download";
import type { YtSearchResult } from "@/server/services/yt-service";

// We deliberately use a plain API route (not a Server Action) for this slow
// operation. React's Server Action runtime serializes per-client transitions,
// so a 100s yt-dlp download was blocking every other server action (Songs,
// Albums, Artists, etc.) until it finished. Plain fetch lands here without
// touching that queue, leaving the rest of the app responsive.

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
    const result = await runYtDownload(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mu] yt-download route failed:", message);
    return NextResponse.json({ error: "download_failed", message }, { status: 500 });
  }
}
