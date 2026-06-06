// YT download orchestration.
//
// Split into two phases so the HTTP request doesn't sit open for the full
// download (Cloudflare's free-plan edge times out at 100s, which kills any
// >100s download even though the upstream Node process keeps running).
//
//   Phase 1 — createPendingDownload (fast, awaited by API route)
//     Creates / refreshes the Track row + YtCacheEntry as DOWNLOADING.
//     Returns the trackId so the client knows what to poll for.
//
//   Phase 2 — runDownloadJob (slow, fire-and-forget)
//     Spawns yt-dlp, finalizes the DB row, marks YtCacheEntry READY.
//     Runs in the Node process independently of the original HTTP request.
//
// Clients poll GET /api/yt-status/[ytVideoId] to learn when Phase 2 finishes
// and the audio is actually playable.

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

export interface CreateDownloadResult {
  trackId: string;
  cached: boolean; // already-downloaded → no Phase 2 needed
}

/**
 * Phase 1: create the Track row + YtCacheEntry, return trackId. Fast (~50ms).
 */
export async function createPendingDownload(
  result: YtSearchResult,
): Promise<CreateDownloadResult> {
  const existing = await db.track.findUnique({
    where: { ytVideoId: result.videoId },
    select: { id: true, source: true, filePath: true },
  });
  if (existing && existing.source === "YT_CACHED" && existing.filePath) {
    // Verify file still on disk; if it's gone we'll re-download.
    try {
      await fs.stat(existing.filePath);
      return { trackId: existing.id, cached: true };
    } catch {
      /* fall through to re-download */
    }
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

  return { trackId, cached: false };
}

/**
 * Phase 2: actually download the audio, finalize the Track row, mark cache
 * entry READY. Runs in the background — DOES NOT block the HTTP response.
 *
 * Errors are caught internally and recorded on the YtCacheEntry so the
 * client polling /api/yt-status sees them.
 */
export async function runDownloadJob(
  result: YtSearchResult,
  trackId: string,
): Promise<void> {
  const log = (phase: string, extra?: object) =>
    console.log(`[mu] runDownloadJob/${result.videoId} ${phase}`, extra ?? "");
  const t0 = Date.now();
  log("start", { title: result.title });

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
    log("end:fail", { totalMs: Date.now() - t0, message: message.slice(0, 200) });
    await db.ytCacheEntry
      .update({
        where: { ytVideoId: result.videoId },
        data: { status: "FAILED", errorMessage: message.slice(0, 500) },
      })
      .catch(() => {
        /* DB might be down; best-effort */
      });
  }
}

export interface YtStatus {
  ytVideoId: string;
  trackId: string | null;
  status: "DOWNLOADING" | "READY" | "FAILED" | "UNKNOWN";
  errorMessage: string | null;
}

export async function getYtStatus(ytVideoId: string): Promise<YtStatus> {
  const entry = await db.ytCacheEntry.findUnique({
    where: { ytVideoId },
    select: { ytVideoId: true, trackId: true, status: true, errorMessage: true },
  });
  if (!entry) {
    return { ytVideoId, trackId: null, status: "UNKNOWN", errorMessage: null };
  }
  return {
    ytVideoId: entry.ytVideoId,
    trackId: entry.trackId,
    status: entry.status as YtStatus["status"],
    errorMessage: entry.errorMessage,
  };
}
