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
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!track.filePath) {
    // YT downloads are now synchronous (await in selectYtResult), so a track
    // reaching the audio engine without a filePath means the download didn't
    // complete. Surfacing as 501 — user should re-search and pick again.
    return NextResponse.json(
      { error: "download_incomplete", source: track.source },
      { status: 501 },
    );
  }

  let stats;
  try {
    stats = await stat(track.filePath);
  } catch {
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
