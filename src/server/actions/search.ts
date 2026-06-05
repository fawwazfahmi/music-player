"use server";

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { searchLibrary as serviceSearch } from "@/server/services/search";
import {
  searchYt as ytServiceSearch,
  downloadAudio,
  type YtSearchResult,
} from "@/server/services/yt-service";
import { parseYtTitle } from "@/server/services/yt-title-parser";

const CACHE_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "yt");

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export async function searchLibrary(query: string) {
  return serviceSearch(query);
}

export async function searchYt(query: string): Promise<YtSearchResult[]> {
  return ytServiceSearch(query, 5);
}

/**
 * Pick a YT result. Downloads the m4a synchronously (~15-30s for typical 3-5min
 * tracks), creates the Track row as YT_CACHED, returns trackId. The caller
 * shows a "Downloading..." indicator while awaiting.
 *
 * Note: Stream-then-cache was originally planned, but YouTube SABR streaming
 * + bot detection makes `yt-dlp -g` direct-URL resolution take 80-110s.
 * Downloading the full file is actually faster AND more reliable.
 */
export async function selectYtResult(
  result: YtSearchResult,
): Promise<{ trackId: string }> {
  const existing = await db.track.findUnique({
    where: { ytVideoId: result.videoId },
    select: { id: true, source: true },
  });
  if (existing && existing.source === "YT_CACHED") {
    return { trackId: existing.id };
  }

  // Parse the YT video title into a clean artist + song title.
  // "Sabrina Carpenter - Manchild (Official Video)" by uploader "Dan Music"
  //   → artist "Sabrina Carpenter", title "Manchild"
  // If no "Artist - Title" pattern is found, falls back to uploader.
  const parsed = parseYtTitle(result.title, result.uploader);

  const artist = await db.artist.upsert({
    where: { name: parsed.artist },
    create: { name: parsed.artist, discoveredAt: new Date() },
    update: {},
  });
  const album = await db.album.upsert({
    where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
    create: { title: "YouTube", artistId: artist.id },
    update: {},
  });

  let trackId: string;
  if (existing) {
    trackId = existing.id;
  } else {
    const newTrack = await db.track.create({
      data: {
        title: parsed.title,
        duration: result.duration,
        primaryArtistId: artist.id,
        albumId: album.id,
        ytVideoId: result.videoId,
        source: "YT_STREAMING",
        playable: true,
        discoveredAt: new Date(),
      },
      select: { id: true },
    });
    trackId = newTrack.id;
    await db.metadataJob.create({
      data: { entityType: "TRACK", trackId, status: "QUEUED" },
    });
  }

  await db.ytCacheEntry.upsert({
    where: { ytVideoId: result.videoId },
    create: {
      ytVideoId: result.videoId,
      trackId,
      status: "DOWNLOADING",
      attempts: 1,
    },
    update: { status: "DOWNLOADING", attempts: { increment: 1 } },
  });

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const { filePath, fileFormat } = await downloadAudio(result.videoId, CACHE_DIR);
    const sha = await sha256(filePath);
    const stats = await fs.stat(filePath);
    await db.track.update({
      where: { id: trackId },
      data: {
        filePath,
        fileFormat,
        fileSize: BigInt(stats.size),
        sha256: sha,
        source: "YT_CACHED",
      },
    });
    await db.ytCacheEntry.update({
      where: { ytVideoId: result.videoId },
      data: { status: "READY", completedAt: new Date(), localFilePath: filePath },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ytCacheEntry.update({
      where: { ytVideoId: result.videoId },
      data: { status: "FAILED", errorMessage: message.slice(0, 500) },
    });
    throw err;
  }

  return { trackId };
}
