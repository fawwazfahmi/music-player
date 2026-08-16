// Apply grounded title/artist/album cleanup across the library. Snapshots every
// track's original title/artist/album FIRST (reversible), then applies.
// Usage: pnpm exec tsx --env-file=.env scripts/clean-titles-apply.ts [limit]

import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { applyCleanMeta } from "@/server/services/title-cleaner";

const SNAPSHOT = path.join(process.cwd(), "scripts", ".title-cleanup-snapshot.json");

export async function applyAll(limit?: number): Promise<{ changed: number; scanned: number }> {
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

  // Reversibility: save originals before touching anything.
  fs.writeFileSync(
    SNAPSHOT,
    JSON.stringify(
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        primary: t.primaryArtist.name,
        additional: t.additionalArtists.map((a) => a.artist.name),
        album: t.album?.title ?? null,
      })),
      null,
      2,
    ),
  );

  let changed = 0;
  for (let i = 0; i < tracks.length; i++) {
    const res = await applyCleanMeta(tracks[i]!.id);
    if (res.changed) {
      changed++;
      console.log(`✓ ${tracks[i]!.title}  →  "${res.title}" — ${res.artists?.join(", ")}`);
    }
    if ((i + 1) % 15 === 0) console.log(`  …${i + 1}/${tracks.length}`);
  }
  return { changed, scanned: tracks.length };
}

if (process.argv[1]?.endsWith("clean-titles-apply.ts")) {
  const limitArg = process.argv.find((a) => /^\d+$/.test(a));
  applyAll(limitArg ? Number(limitArg) : undefined)
    .then((r) => {
      console.log(`\n[clean] done — changed ${r.changed}/${r.scanned} (snapshot: ${SNAPSHOT})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[clean] apply failed:", err);
      process.exit(1);
    });
}
