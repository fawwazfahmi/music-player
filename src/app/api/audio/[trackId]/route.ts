import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { parseRange } from "@/server/services/audio-stream";
import { resolveDirectUrl } from "@/server/services/yt-service";
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

async function streamFromYt(videoId: string, req: Request): Promise<Response> {
  let directUrl: string;
  try {
    directUrl = await resolveDirectUrl(videoId);
  } catch {
    return NextResponse.json({ error: "yt_resolve_failed" }, { status: 502 });
  }
  if (!directUrl) {
    return NextResponse.json({ error: "yt_resolve_empty" }, { status: 502 });
  }
  const range = req.headers.get("range");
  const ytRes = await fetch(directUrl, {
    headers: range ? { Range: range } : undefined,
  });
  if (!ytRes.ok && ytRes.status !== 206) {
    return NextResponse.json(
      { error: "yt_fetch_failed", status: ytRes.status },
      { status: 502 },
    );
  }
  const headers = new Headers();
  headers.set("Content-Type", ytRes.headers.get("content-type") ?? "audio/mp4");
  const cl = ytRes.headers.get("content-length");
  if (cl) headers.set("Content-Length", cl);
  const cr = ytRes.headers.get("content-range");
  if (cr) headers.set("Content-Range", cr);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  return new Response(ytRes.body, { status: ytRes.status, headers });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: { filePath: true, fileFormat: true, source: true, ytVideoId: true },
  });
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!track.filePath) {
    if (track.source === "YT_STREAMING" && track.ytVideoId) {
      return streamFromYt(track.ytVideoId, req);
    }
    return NextResponse.json({ error: "not_yet_supported", reason: track.source }, { status: 501 });
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
