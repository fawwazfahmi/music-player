import { rm } from "node:fs/promises";
import { db } from "@/server/db";
import { isEphemeralStale } from "@/lib/ephemeral-stale";

export interface SweeperDeps {
  unlink?: (filePath: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Delete ephemeral "trying it out" picks that were never adopted and have gone
 * cold (see isEphemeralStale): removes the audio file, then the Track row
 * (cascading YtCacheEntry / history). Best-effort per track; returns how many
 * were removed. Injectable deps keep it testable without real disk/time.
 */
export async function cleanupEphemeralTracks(deps: SweeperDeps = {}): Promise<{ removed: number }> {
  const unlink = deps.unlink ?? ((p: string) => rm(p, { force: true }));
  const now = deps.now ? deps.now() : new Date();

  const candidates = await db.track.findMany({
    where: { inLibrary: false },
    select: { id: true, filePath: true, createdAt: true },
  });

  let removed = 0;
  for (const t of candidates) {
    const last = await db.listeningHistory.findFirst({
      where: { trackId: t.id },
      orderBy: { playedAt: "desc" },
      select: { playedAt: true },
    });
    if (!isEphemeralStale({ inLibrary: false, createdAt: t.createdAt, lastPlayedAt: last?.playedAt ?? null, now })) {
      continue;
    }
    if (t.filePath) {
      try {
        await unlink(t.filePath);
      } catch {
        /* file may already be gone — don't block the row delete */
      }
    }
    await db.track.delete({ where: { id: t.id } }).catch(() => {});
    removed++;
  }

  if (removed > 0) console.log(`[mu] ephemeral sweeper removed ${removed} un-kept pick(s)`);
  return { removed };
}

let started = false;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h

/** Start the periodic sweep (once per process). Runs shortly after boot, then
    on an interval. */
export function startEphemeralSweeper(): void {
  if (started) return;
  started = true;
  const run = () =>
    void cleanupEphemeralTracks().catch((err) => console.error("[mu] ephemeral sweep failed:", err));
  setTimeout(run, 60_000); // 1 min after boot
  setInterval(run, SWEEP_INTERVAL_MS);
}
