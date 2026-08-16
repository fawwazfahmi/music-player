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
import { scrubCookiePaths, anyConnectedCookiePath } from "@/server/services/yt-cookies";
import { enrichTrackExtras } from "@/server/services/track-enrich";

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
  opts: { ephemeral?: boolean } = {},
): Promise<CreateDownloadResult> {
  // Ephemeral picks play but don't join the library until adopted. A pick that
  // already IS a cached library track (early-return below) is never demoted.
  const inLibrary = !(opts.ephemeral ?? false);
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

  // Adopt-from-disk: even with no DB row referencing it, the m4a file may
  // already exist in CACHE_DIR (typical after a DB wipe — audio files in
  // .cache/yt/ outlive the postgres data). If we find one, finalize the
  // Track + YtCacheEntry rows immediately and return cached=true so the
  // caller skips the yt-dlp download entirely.
  const candidatePath = path.join(CACHE_DIR, `${result.videoId}.m4a`);
  const onDisk = await fs.stat(candidatePath).catch(() => null);
  const adoptFromDisk = !!onDisk && onDisk.isFile() && onDisk.size > 0;

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
    // Existing row from a previously-failed attempt — hide it from lists
    // until this fresh attempt completes.
    await db.track.update({
      where: { id: trackId },
      data: { playable: false, inLibrary },
    });
  } else {
    const newTrack = await db.track.create({
      data: {
        title: parsed.title,
        duration: result.duration,
        primaryArtistId: artist.id,
        albumId: album.id,
        ytVideoId: result.videoId,
        source: "YT_STREAMING",
        // Hide from library lists until the m4a actually lands. Once
        // runDownloadJob finishes successfully we flip this back to true.
        playable: false,
        inLibrary,
        discoveredAt: new Date(),
      },
      select: { id: true },
    });
    trackId = newTrack.id;
    await db.metadataJob.create({
      data: { entityType: "TRACK", trackId, status: "QUEUED" },
    });
  }

  if (adoptFromDisk && onDisk) {
    // File is already on disk — finalize the rows as YT_CACHED immediately.
    // sha256 of an existing m4a takes ~50ms for typical 3-5MB files; fast
    // enough to do synchronously inline rather than fire-and-forget.
    const sha = await sha256(candidatePath);
    await db.track.update({
      where: { id: trackId },
      data: {
        filePath: candidatePath,
        fileFormat: "m4a",
        fileSize: BigInt(onDisk.size),
        sha256: sha,
        source: "YT_CACHED",
        playable: true,
        inLibrary,
      },
    });
    await db.ytCacheEntry.upsert({
      where: { ytVideoId: result.videoId },
      create: {
        ytVideoId: result.videoId,
        trackId,
        status: "READY",
        attempts: 1,
        completedAt: new Date(),
        localFilePath: candidatePath,
      },
      update: {
        status: "READY",
        attempts: { increment: 1 },
        completedAt: new Date(),
        localFilePath: candidatePath,
        errorMessage: null,
      },
    });
    console.log(
      `[mu] createPendingDownload/${result.videoId}: adopted existing file from disk (${onDisk.size} bytes) — skipped yt-dlp`,
    );
    return { trackId, cached: true };
  }

  await db.ytCacheEntry.upsert({
    where: { ytVideoId: result.videoId },
    create: {
      ytVideoId: result.videoId,
      trackId,
      status: "DOWNLOADING",
      attempts: 1,
    },
    // Reset errorMessage and completedAt so a previously-failed entry that
    // we're retrying doesn't visually look both READY and 'had an error' once
    // the new attempt succeeds.
    update: {
      status: "DOWNLOADING",
      attempts: { increment: 1 },
      errorMessage: null,
      completedAt: null,
    },
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

    // Throttle DB progress writes — yt-dlp emits a progress line every ~1s
    // but writing every tick to PG is wasteful. Write at most every 750ms.
    let lastWrite = 0;
    let lastPct = -1;
    const tDl0 = Date.now();
    // Authenticate the media fetch with a logged-in jar when one exists —
    // anonymous downloads get YouTube 403s (esp. under burst/throttle).
    const cookiePath = await anyConnectedCookiePath();
    const { filePath, fileFormat } = await downloadAudio(result.videoId, CACHE_DIR, {
      cookiePath,
      onProgress: (p) => {
        const now = Date.now();
        // Always write the first tick (so client sees totalBytes ASAP) and
        // every 750ms thereafter, or whenever pct jumps >= 5 points.
        if (now - lastWrite < 750 && Math.abs(p.pct - lastPct) < 5) return;
        lastWrite = now;
        lastPct = p.pct;
        const downloadedBytes =
          p.totalBytes !== null ? Math.round((p.pct / 100) * p.totalBytes) : 0;
        void db.ytCacheEntry
          .update({
            where: { ytVideoId: result.videoId },
            data: {
              downloadedBytes: BigInt(downloadedBytes),
              totalBytes: p.totalBytes !== null ? BigInt(p.totalBytes) : null,
            },
          })
          .catch(() => {
            /* transient DB blip — next tick will catch up */
          });
      },
    });
    log("download-done", { ms: Date.now() - tDl, sinceFirstTick: Date.now() - tDl0 });

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
        // File is now on disk — surface in the library list.
        playable: true,
      },
    });
    await db.ytCacheEntry.update({
      where: { ytVideoId: result.videoId },
      data: {
        status: "READY",
        completedAt: new Date(),
        localFilePath: filePath,
        // Clear any leftover errorMessage from a previous failed attempt.
        errorMessage: null,
      },
    });
    // The file is now on disk, so genres + audio + mood can all run for real.
    // Force re-seed: the early metadata job may have seeded moods before the
    // audio existed; now we redo them audio-informed. Never throws.
    await enrichTrackExtras(trackId, { force: true }).catch(() => {});
    log("end:ok", { totalMs: Date.now() - t0 });
  } catch (err) {
    // Scrub before logging or persisting: yt-dlp stderr can echo the
    // --cookies path, which points straight at a file of live Google
    // credentials. No reason for that to land in logs or the database.
    const message = scrubCookiePaths(err instanceof Error ? err.message : String(err));
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
  /** 0..100 — real progress reported by yt-dlp. Null when yt-dlp hasn't
      emitted its first tick yet (so the client can show an indeterminate
      state for a beat). */
  progressPct: number | null;
}

/**
 * Crash recovery — run on app boot. Marks any YtCacheEntry stuck in
 * DOWNLOADING as FAILED (the yt-dlp child process was killed when the
 * Node process restarted), and flips the Track row to playable=false
 * so it no longer shows up in the library list. The user can re-pick
 * the same YT result to retry.
 */
export async function resetStuckDownloads(): Promise<{ marked: number }> {
  const stuck = await db.ytCacheEntry.findMany({
    where: { status: "DOWNLOADING" },
    select: { ytVideoId: true, trackId: true },
  });
  if (stuck.length === 0) return { marked: 0 };

  await db.ytCacheEntry.updateMany({
    where: { ytVideoId: { in: stuck.map((s) => s.ytVideoId) } },
    data: {
      status: "FAILED",
      errorMessage: "Server restarted while download was in flight",
    },
  });
  await db.track.updateMany({
    where: {
      id: { in: stuck.map((s) => s.trackId).filter((x): x is string => !!x) },
      filePath: null,
    },
    data: { playable: false },
  });
  console.log(`[mu] yt-download: reset ${stuck.length} stuck DOWNLOADING entries`);
  return { marked: stuck.length };
}

// ─── Playlist / mix batch ─────────────────────────────────────────────────

export interface EnqueueSelectedResult {
  /** Rows created (or already present) for every selected video. */
  total: number;
  /** How many were already on disk and needed no download at all. */
  alreadyCached: number;
  trackIds: string[];
}

/**
 * Create Track + YtCacheEntry rows for an explicit, user-pruned selection,
 * then kick off the sequential background download chain for the ones not
 * already on disk.
 *
 * Deliberately does NOT touch the play queue. The user picks these up from
 * the Downloads screen once they've landed, so starting a batch never
 * interrupts what's currently playing or reorders anything queued.
 *
 * Returns as soon as the rows exist — downloads keep running in the Node
 * process well after this resolves.
 */
export async function enqueueSelected(
  videos: YtSearchResult[],
): Promise<EnqueueSelectedResult> {
  const trackIds: string[] = [];
  const pending: { video: YtSearchResult; trackId: string }[] = [];
  let alreadyCached = 0;

  for (const v of videos) {
    try {
      const { trackId, cached } = await createPendingDownload(v);
      trackIds.push(trackId);
      if (cached) alreadyCached += 1;
      else pending.push({ video: v, trackId });
    } catch (err) {
      console.error(`[mu] enqueue failed for ${v.videoId}`, err);
    }
  }

  // Sequential so a 40-song selection doesn't fork 40 yt-dlp processes at
  // once. Stays alive in the Node process independently of the HTTP request.
  void runPlaylistDownloadChain(pending);

  return { total: trackIds.length, alreadyCached, trackIds };
}

async function runPlaylistDownloadChain(
  items: { video: YtSearchResult; trackId: string }[],
): Promise<void> {
  for (const item of items) {
    try {
      await runDownloadJob(item.video, item.trackId);
    } catch (err) {
      console.error(`[mu] playlist download failed for ${item.video.videoId}`, err);
    }
  }
  console.log(`[mu] playlist download chain finished (${items.length} videos)`);
}

// ─── Downloads screen ─────────────────────────────────────────────────────

export interface DownloadRow {
  ytVideoId: string;
  trackId: string | null;
  title: string;
  artist: string;
  status: "DOWNLOADING" | "READY" | "FAILED" | "PENDING";
  progressPct: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  duration: number;
  /** True once the file is on disk and the row is safe to queue. */
  playable: boolean;
}

/** How far back the Downloads screen shows finished work. */
const DOWNLOADS_HISTORY_MS = 24 * 60 * 60 * 1000;

function pctOf(downloaded: bigint, total: bigint | null): number | null {
  if (total === null) return null;
  const t = Number(total);
  if (!t) return null;
  return Math.min(100, Math.round((Number(downloaded) / t) * 100));
}

/**
 * Everything in flight or failed, plus anything completed in the last 24h.
 * Read straight from YtCacheEntry so the view survives a page reload and
 * reflects downloads started from any device — the client store only ever
 * knew about jobs the current tab kicked off.
 */
export async function listDownloads(): Promise<DownloadRow[]> {
  const cutoff = new Date(Date.now() - DOWNLOADS_HISTORY_MS);
  const entries = await db.ytCacheEntry.findMany({
    where: {
      OR: [
        { status: { in: ["DOWNLOADING", "PENDING", "FAILED"] } },
        { status: "READY", completedAt: { gte: cutoff } },
      ],
    },
    select: {
      ytVideoId: true,
      trackId: true,
      status: true,
      errorMessage: true,
      completedAt: true,
      createdAt: true,
      downloadedBytes: true,
      totalBytes: true,
      track: {
        select: {
          title: true,
          duration: true,
          playable: true,
          primaryArtist: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rank: Record<string, number> = { DOWNLOADING: 0, PENDING: 0, FAILED: 1, READY: 2 };
  return entries
    .map((e): DownloadRow => ({
      ytVideoId: e.ytVideoId,
      trackId: e.trackId,
      title: e.track?.title ?? e.ytVideoId,
      artist: e.track?.primaryArtist?.name ?? "Unknown",
      status: e.status as DownloadRow["status"],
      progressPct: pctOf(e.downloadedBytes, e.totalBytes),
      errorMessage: e.errorMessage,
      completedAt: e.completedAt?.toISOString() ?? null,
      duration: e.track?.duration ?? 0,
      playable: e.track?.playable ?? false,
    }))
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
}

/**
 * Re-run a failed download. Rebuilds the YtSearchResult from the Track row we
 * already have, so the caller only needs the video id.
 */
export async function retryDownload(ytVideoId: string): Promise<void> {
  const entry = await db.ytCacheEntry.findUnique({
    where: { ytVideoId },
    select: {
      trackId: true,
      track: {
        select: { title: true, duration: true, primaryArtist: { select: { name: true } } },
      },
    },
  });
  if (!entry?.trackId || !entry.track) {
    throw new Error("No download to retry for that video");
  }
  await db.ytCacheEntry.update({
    where: { ytVideoId },
    data: {
      status: "DOWNLOADING",
      errorMessage: null,
      completedAt: null,
      downloadedBytes: 0n,
      totalBytes: null,
      attempts: { increment: 1 },
    },
  });
  void runDownloadJob(
    {
      videoId: ytVideoId,
      title: entry.track.title,
      uploader: entry.track.primaryArtist?.name ?? "Unknown",
      duration: entry.track.duration,
      thumbnail: null,
    },
    entry.trackId,
  );
}

export async function getYtStatus(ytVideoId: string): Promise<YtStatus> {
  const entry = await db.ytCacheEntry.findUnique({
    where: { ytVideoId },
    select: {
      ytVideoId: true,
      trackId: true,
      status: true,
      errorMessage: true,
      downloadedBytes: true,
      totalBytes: true,
    },
  });
  if (!entry) {
    return {
      ytVideoId,
      trackId: null,
      status: "UNKNOWN",
      errorMessage: null,
      progressPct: null,
    };
  }
  const dl = Number(entry.downloadedBytes ?? 0n);
  const total = entry.totalBytes !== null ? Number(entry.totalBytes) : null;
  const progressPct = total && total > 0 ? Math.min(100, Math.round((dl / total) * 100)) : null;
  return {
    ytVideoId: entry.ytVideoId,
    trackId: entry.trackId,
    status: entry.status as YtStatus["status"],
    errorMessage: entry.errorMessage,
    progressPct,
  };
}
