// Manual batch import of a YouTube playlist / mix / single video — same
// pipeline as the web /api/yt-playlist flow (Track + YtCacheEntry rows,
// source = YT_CACHED, ytVideoId set so the iframe + lyrics work),
// without the web's safety cap. Run as many in parallel as you want.
//
// Each video lands in MUSIC_LIBRARY_PATH/.cache/yt/<videoId>.m4a and gets a
// MetadataJob queued, so the running app's metadata worker enriches them
// (MusicBrainz + cover art) afterwards. Lyrics are fetched on the first
// view of the lyrics panel — LRCLIB first, Whisper auto-transcribe if no
// match. Same as web.
//
// Usage:
//   pnpm exec tsx --env-file=.env scripts/yt-mix.ts <URL>
//   pnpm exec tsx --env-file=.env scripts/yt-mix.ts <URL> 100
//   pnpm exec tsx --env-file=.env scripts/yt-mix.ts <URL> all
//   CONCURRENCY=3 pnpm exec tsx --env-file=.env scripts/yt-mix.ts <URL>
//
// Args:
//   URL     YT playlist / mix / single video URL
//   LIMIT   number of entries to import (default 50; 'all' for no cap)
//
// Env:
//   CONCURRENCY  how many yt-dlp processes to run at once (default 2)

import { fetchPlaylist, type YtSearchResult } from "@/server/services/yt-service";
import {
  createPendingDownload,
  runDownloadJob,
} from "@/server/services/yt-download";
import { db } from "@/server/db";

const URL = process.argv[2];
const RAW_LIMIT = process.argv[3] ?? "50";
const LIMIT = RAW_LIMIT === "all" ? Number.POSITIVE_INFINITY : parseInt(RAW_LIMIT, 10);
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY ?? "2", 10));

function exitUsage(msg?: string): never {
  if (msg) console.error("✗ " + msg);
  console.error(
    "Usage: pnpm exec tsx --env-file=.env scripts/yt-mix.ts <url> [limit|all]",
  );
  process.exit(1);
}

function isPlaylistish(url: string): boolean {
  return /[?&]list=/.test(url);
}

function singleVideoFromUrl(url: string): YtSearchResult | null {
  try {
    const u = new globalThis.URL(url);
    const id = u.searchParams.get("v") ?? u.pathname.replace(/^\//, "");
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return {
      videoId: id,
      title: id,
      uploader: "YouTube",
      duration: 0,
      thumbnail: null,
    };
  } catch {
    return null;
  }
}

async function main() {
  if (!URL || !URL.startsWith("http")) exitUsage("missing or invalid URL");
  if (Number.isNaN(LIMIT)) exitUsage(`invalid limit "${RAW_LIMIT}"`);

  let videos: YtSearchResult[] = [];

  if (isPlaylistish(URL)) {
    console.log("→ Fetching playlist via yt-dlp --flat-playlist…");
    const all = await fetchPlaylist(URL);
    if (all.length === 0) exitUsage("playlist returned 0 entries — check the URL");
    videos = all.slice(0, Number.isFinite(LIMIT) ? LIMIT : all.length);
    console.log(
      `  ${all.length} entries available, importing ${videos.length}` +
        (videos.length < all.length ? ` (limit=${LIMIT})` : ""),
    );
  } else {
    const v = singleVideoFromUrl(URL);
    if (!v) exitUsage("could not extract video id from URL");
    videos = [v];
    console.log(`→ Single video: ${v.videoId}`);
  }

  // ── Phase 1: create Track + YtCacheEntry rows ─────────────────────────
  console.log("\n→ Creating Track rows…");
  const queue: Array<{ video: YtSearchResult; trackId: string }> = [];
  let alreadyCached = 0;
  for (const v of videos) {
    try {
      const { trackId, cached } = await createPendingDownload(v);
      if (cached) alreadyCached++;
      else queue.push({ video: v, trackId });
    } catch (err) {
      console.error(`  ✗ ${v.videoId}: ${(err as Error).message}`);
    }
  }
  console.log(
    `  ${videos.length} rows ready · ${alreadyCached} already cached · ${queue.length} to download`,
  );

  if (queue.length === 0) {
    console.log("\n✓ Nothing to do.");
    await db.$disconnect();
    return;
  }

  // ── Phase 2: pool runDownloadJob with CONCURRENCY workers ─────────────
  console.log(`\n→ Downloading with ${CONCURRENCY} parallel worker(s)…`);
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  const total = queue.length;

  async function worker(id: number) {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      const idx = done + failed + 1;
      const label = item.video.title.slice(0, 60);
      console.log(`  [w${id}] ${idx}/${total} ▸ ${label}`);
      try {
        await runDownloadJob(item.video, item.trackId);
        done++;
      } catch (err) {
        failed++;
        console.error(`  [w${id}] ✗ ${item.video.videoId}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\n✓ ${done}/${total} downloaded in ${elapsedSec}s` +
      (failed > 0 ? `, ${failed} failed` : ""),
  );
  console.log(
    "  Metadata enrichment (MusicBrainz + cover art) runs in the background",
  );
  console.log(
    "  via the app's metadata worker. Lyrics fetch + auto-transcribe happens",
  );
  console.log("  on first view of each track's Lyrics panel.");

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("\n✗ fatal:", err);
  try {
    await db.$disconnect();
  } catch {}
  process.exit(1);
});
