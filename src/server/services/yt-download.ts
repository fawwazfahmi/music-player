// YT download orchestration — extracted from src/server/actions/search.ts so
// the API route can invoke it directly without going through the React Server
// Action queue (which serializes per-client and was blocking unrelated server
// actions like getAllSongs for the entire duration of a download).

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { downloadAudio, type YtSearchResult } from "@/server/services/yt-service";
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

export async function runYtDownload(
  result: YtSearchResult,
): Promise<{ trackId: string }> {
  const log = (phase: string, extra?: object) =>
    console.log(`[mu] runYtDownload/${result.videoId} ${phase}`, extra ?? "");
  const t0 = Date.now();
  log("start", { title: result.title });

  const existing = await db.track.findUnique({
    where: { ytVideoId: result.videoId },
    select: { id: true, source: true },
  });
  if (existing && existing.source === "YT_CACHED") {
    log("end:cache-hit", { ms: Date.now() - t0 });
    return { trackId: existing.id };
  }

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
    const tDl = Date.now();
    const { filePath, fileFormat } = await downloadAudio(result.videoId, CACHE_DIR);
    log("download-done", { ms: Date.now() - tDl });

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
    log("end:ok", { totalMs: Date.now() - t0 });
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
