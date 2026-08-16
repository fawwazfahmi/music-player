// Seed baseline mood affinities for existing tracks that have none yet.
// Usage: pnpm exec tsx --env-file=.env scripts/backfill-mood-seeds.ts [limit]

import { db } from "@/server/db";
import { seedTrackMoodAffinities } from "@/server/services/mood-seeder";
import { ensureBuiltinMoods } from "@/server/services/mood-store";

interface BackfillOpts {
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  /** Injectable for tests; defaults to the real seeder. */
  seeder?: (trackId: string) => Promise<string[]>;
}

/** Seed mood affinities for every track without any. Sequential — the seeder
    calls Ollama per track, so parallelism buys nothing. */
export async function backfillMoodSeeds(
  opts: BackfillOpts = {},
): Promise<{ seeded: number; scanned: number }> {
  await ensureBuiltinMoods();
  const seeder = opts.seeder ?? seedTrackMoodAffinities;
  const tracks = await db.track.findMany({
    where: { moodSeeds: { none: {} } },
    select: { id: true },
    take: opts.limit,
  });
  let seeded = 0;
  for (let i = 0; i < tracks.length; i++) {
    const applied = await seeder(tracks[i]!.id);
    if (applied.length > 0) seeded++;
    opts.onProgress?.(i + 1, tracks.length);
  }
  return { seeded, scanned: tracks.length };
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("backfill-mood-seeds.ts")) {
  const limitArg = process.argv[2] ? Number(process.argv[2]) : undefined;
  backfillMoodSeeds({
    limit: Number.isFinite(limitArg) ? limitArg : undefined,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.log(`[moods] ${done}/${total}`);
    },
  })
    .then((r) => {
      console.log(`[moods] done — seeded ${r.seeded}/${r.scanned} tracks`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[moods] backfill failed:", err);
      process.exit(1);
    });
}
