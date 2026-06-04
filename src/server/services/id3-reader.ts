import { parseFile } from "music-metadata";
import path from "node:path";

export interface TrackMetadata {
  title: string;
  artistName: string;
  albumTitle: string;
  durationSec: number;
  trackNumber: number | null;
  discNumber: number | null;
  bitrate: number | null;
  fileFormat: string;
}

export async function readTrackMetadata(filePath: string): Promise<TrackMetadata> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const filenameTitle = path.basename(filePath, path.extname(filePath));

  let tags: Awaited<ReturnType<typeof parseFile>>["common"] | null = null;
  let format: Awaited<ReturnType<typeof parseFile>>["format"] | null = null;
  try {
    const parsed = await parseFile(filePath, { duration: true });
    tags = parsed.common;
    format = parsed.format;
  } catch {
    // bad/empty file — fall through to filename-based defaults
  }

  return {
    title: tags?.title?.trim() || filenameTitle,
    artistName: tags?.artist?.trim() || tags?.albumartist?.trim() || "Unknown Artist",
    albumTitle: tags?.album?.trim() || "Unknown Album",
    durationSec: Math.round(format?.duration ?? 0),
    trackNumber: tags?.track?.no ?? null,
    discNumber: tags?.disk?.no ?? null,
    bitrate: format?.bitrate ?? null,
    fileFormat: ext,
  };
}
