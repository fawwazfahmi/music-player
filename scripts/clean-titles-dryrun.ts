// DRY RUN: propose cleaned titles/artists for the library. Writes NOTHING to
// the DB — just prints before→after and saves a JSON report for the apply step.
// Usage: pnpm exec tsx --env-file=.env scripts/clean-titles-dryrun.ts [limit]

import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { cleanTrackMeta } from "@/server/services/title-cleaner";

export interface ProposedChange {
  trackId: string;
  before: { title: string; artist: string };
  after: { title: string; artists: string[] };
}

const REPORT = path.join(process.cwd(), "scripts", ".title-cleanup.json");

function artistsDiffer(currentPrimary: string, currentExtra: string[], proposed: string[]): boolean {
  const cur = [currentPrimary, ...currentExtra].map((a) => a.toLowerCase());
  const next = proposed.map((a) => a.toLowerCase());
  if (cur.length !== next.length) return true;
  return next.some((a, i) => a !== cur[i]);
}

export async function dryRun(limit?: number): Promise<ProposedChange[]> {
  const tracks = await db.track.findMany({
    where: { playable: true },
    take: limit,
    select: {
      id: true,
      title: true,
      primaryArtist: { select: { name: true } },
      additionalArtists: { select: { artist: { select: { name: true } } } },
      album: { select: { title: true } },
    },
  });

  const changes: ProposedChange[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!;
    const extra = t.additionalArtists.map((a) => a.artist.name);
    const r = await cleanTrackMeta({
      title: t.title,
      artist: t.primaryArtist.name,
      album: t.album?.title ?? "",
    });
    if (r) {
      const titleChanged = r.title !== t.title;
      const artistChanged = artistsDiffer(t.primaryArtist.name, extra, r.artists);
      if (titleChanged || artistChanged) {
        changes.push({
          trackId: t.id,
          before: { title: t.title, artist: [t.primaryArtist.name, ...extra].join(", ") },
          after: { title: r.title, artists: r.artists },
        });
      }
    }
    if ((i + 1) % 15 === 0) console.log(`  …scanned ${i + 1}/${tracks.length}`);
  }
  return changes;
}

if (process.argv[1]?.endsWith("clean-titles-dryrun.ts")) {
  const limitArg = process.argv.find((a) => /^\d+$/.test(a));
  dryRun(limitArg ? Number(limitArg) : undefined)
    .then((changes) => {
      fs.writeFileSync(REPORT, JSON.stringify(changes, null, 2));
      console.log(`\n=== ${changes.length} proposed changes ===\n`);
      for (const c of changes) {
        console.log(`• "${c.before.title}"  —  ${c.before.artist}`);
        console.log(`  → "${c.after.title}"  —  ${c.after.artists.join(", ")}\n`);
      }
      console.log(`Report saved to ${REPORT}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("dry-run failed:", err);
      process.exit(1);
    });
}
