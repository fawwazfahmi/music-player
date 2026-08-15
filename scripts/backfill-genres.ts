// Populate genres for existing tracks that have none yet.
// Usage: pnpm exec tsx --env-file=.env scripts/backfill-genres.ts [limit]

import { db } from "@/server/db";
import { tagTrackGenres } from "@/server/services/genre-tagger";

interface BackfillOpts {
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  /** Injectable for tests; defaults to the real tagger. */
  tagger?: (trackId: string) => Promise<string[]>;
}

/** Populate genres for every track that has none yet. Sequential on purpose:
    the tagger hits MusicBrainz (rate-limited to 1 req/s) and Ollama, so
    parallelism buys nothing and risks throttling. */
export async function backfillGenres(
  opts: BackfillOpts = {},
): Promise<{ tagged: number; scanned: number }> {
  const tagger = opts.tagger ?? tagTrackGenres;
  const tracks = await db.track.findMany({
    where: { genres: { none: {} } },
    select: { id: true },
    take: opts.limit,
  });
  let tagged = 0;
  for (let i = 0; i < tracks.length; i++) {
    const applied = await tagger(tracks[i]!.id);
    if (applied.length > 0) tagged++;
    opts.onProgress?.(i + 1, tracks.length);
  }
  return { tagged, scanned: tracks.length };
}

// CLI entry: `pnpm exec tsx --env-file=.env scripts/backfill-genres.ts`
if (process.argv[1] && process.argv[1].endsWith("backfill-genres.ts")) {
  const limitArg = process.argv[2] ? Number(process.argv[2]) : undefined;
  backfillGenres({
    limit: Number.isFinite(limitArg) ? limitArg : undefined,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`[genres] ${done}/${total}`);
    },
  })
    .then((r) => {
      console.log(`[genres] done — tagged ${r.tagged}/${r.scanned} tracks`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[genres] backfill failed:", err);
      process.exit(1);
    });
}
