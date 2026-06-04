import PQueue from "p-queue";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { downloadAudio } from "@/server/services/yt-service";

const queue = new PQueue({ concurrency: 1 });

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

async function processDownload(videoId: string): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await db.ytCacheEntry.update({
    where: { ytVideoId: videoId },
    data: { status: "DOWNLOADING", attempts: { increment: 1 } },
  });
  try {
    const { filePath, fileFormat } = await downloadAudio(videoId, CACHE_DIR);
    const sha = await sha256(filePath);
    const stats = await fs.stat(filePath);
    const entry = await db.ytCacheEntry.findUnique({
      where: { ytVideoId: videoId },
      select: { trackId: true },
    });
    if (entry?.trackId) {
      await db.track.update({
        where: { id: entry.trackId },
        data: {
          filePath,
          fileFormat,
          fileSize: BigInt(stats.size),
          sha256: sha,
          source: "YT_CACHED",
        },
      });
    }
    await db.ytCacheEntry.update({
      where: { ytVideoId: videoId },
      data: { status: "READY", completedAt: new Date(), localFilePath: filePath },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ytCacheEntry.update({
      where: { ytVideoId: videoId },
      data: { status: "FAILED", errorMessage: message.slice(0, 500) },
    });
    throw err;
  }
}

export function enqueueDownload(videoId: string): void {
  void queue.add(() => processDownload(videoId).catch(() => {}));
}

export function queueSize(): number {
  return queue.size + queue.pending;
}
