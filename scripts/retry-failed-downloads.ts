// Re-attempt every FAILED YtCacheEntry, sequentially and awaited, so we can see
// whether the cookie + retry fix actually recovers them.
// Usage: pnpm exec tsx --env-file=.env scripts/retry-failed-downloads.ts
import { db } from "@/server/db";
import { runDownloadJob } from "@/server/services/yt-download";

async function main() {
  const failed = await db.ytCacheEntry.findMany({
    where: { status: "FAILED" },
    select: {
      ytVideoId: true,
      trackId: true,
      track: { select: { title: true, duration: true, primaryArtist: { select: { name: true } } } },
    },
  });
  console.log(`[retry] ${failed.length} failed downloads to re-attempt`);

  for (const f of failed) {
    if (!f.trackId || !f.track) continue;
    await db.ytCacheEntry.update({
      where: { ytVideoId: f.ytVideoId },
      data: { status: "DOWNLOADING", errorMessage: null, completedAt: null, attempts: { increment: 1 } },
    });
    console.log(`\n[retry] ${f.ytVideoId} — ${f.track.title}`);
    try {
      await runDownloadJob(
        {
          videoId: f.ytVideoId,
          title: f.track.title,
          uploader: f.track.primaryArtist?.name ?? "Unknown",
          duration: f.track.duration,
          thumbnail: null,
        },
        f.trackId,
      );
    } catch (e) {
      console.log(`  threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    const after = await db.ytCacheEntry.findUnique({
      where: { ytVideoId: f.ytVideoId },
      select: { status: true, errorMessage: true },
    });
    console.log(`  → ${after?.status}${after?.errorMessage ? " · " + after.errorMessage.slice(0, 120) : ""}`);
  }

  const stillFailed = await db.ytCacheEntry.count({ where: { status: "FAILED" } });
  const ready = await db.ytCacheEntry.count({ where: { status: "READY" } });
  console.log(`\n[retry] done — READY: ${ready}, still FAILED: ${stillFailed}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
