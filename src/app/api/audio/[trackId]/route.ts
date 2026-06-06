import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { parseRange } from "@/server/services/audio-stream";
import fs from "node:fs";
import { stat } from "node:fs/promises";

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: { filePath: true, fileFormat: true, source: true },
  });
  if (!track) {
    console.warn(`[mu] /api/audio/${trackId} → 404 (no track row)`);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!track.filePath) {
    // Track row exists but the audio file isn't materialized yet. Happens
    // when the YT download is still in flight or the row is stale from a
    // failed prior attempt. 425 = Too Early; the audio engine retries.
    console.warn(
      `[mu] /api/audio/${trackId} → 425 (no filePath, source=${track.source})`,
    );
    return NextResponse.json(
      { error: "download_incomplete", source: track.source },
      { status: 425 },
    );
  }

  let stats;
  try {
    stats = await stat(track.filePath);
  } catch {
    console.warn(
      `[mu] /api/audio/${trackId} → 410 (file gone from disk: ${track.filePath})`,
    );
    return NextResponse.json({ error: "file_missing" }, { status: 410 });
  }

  const size = stats.size;
  const mime = MIME_BY_EXT[track.fileFormat ?? ""] ?? "application/octet-stream";
  const rangeHeader = req.headers.get("range");
  const range = parseRange(rangeHeader, size);

  if (range && "error" in range) {
    return new NextResponse("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const { start, end } = range;
    const stream = fs.createReadStream(track.filePath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = fs.createReadStream(track.filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
