// Re-derive the artist for YouTube MV tracks whose stored artist is the label/
// channel (e.g. "JYP Entertainment") but whose title embeds the real artist in
// the K-pop quote format ("TWICE «Strategy» M/V"). Only touches tracks where the
// QUOTED_RE fires AND yields a different artist — safe/targeted.
//
// Usage:
//   dry run:  pnpm exec tsx --env-file=.env scripts/fix-mv-artists.ts
//   apply:    pnpm exec tsx --env-file=.env scripts/fix-mv-artists.ts --apply
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { parseYtTitle, QUOTED_RE } from "@/server/services/yt-title-parser";

const APPLY = process.argv.includes("--apply");
const SNAPSHOT = path.join(process.cwd(), "scripts", ".fix-mv-artists-snapshot.json");

async function main() {
  const tracks = await db.track.findMany({
    where: { ytVideoId: { not: null } },
    select: {
      id: true,
      title: true,
      primaryArtistId: true,
      primaryArtist: { select: { name: true } },
      albumId: true,
      album: { select: { title: true } },
    },
  });

  const changes: { id: string; before: string; after: string; title: string; newTitle: string }[] = [];
  for (const t of tracks) {
    if (!QUOTED_RE.test(t.title)) continue;
    const parsed = parseYtTitle(t.title, t.primaryArtist.name);
    if (parsed.artist.toLowerCase() === t.primaryArtist.name.toLowerCase()) continue;
    changes.push({
      id: t.id,
      before: t.primaryArtist.name,
      after: parsed.artist,
      title: t.title,
      newTitle: parsed.title,
    });
  }

  console.log(`\n${changes.length} MV track(s) with the wrong (label) artist:\n`);
  for (const c of changes) {
    console.log(`  "${c.title}"`);
    console.log(`     ${c.before}  →  ${c.after}   |  title → "${c.newTitle}"\n`);
  }
  if (!APPLY) {
    console.log("(dry run — re-run with --apply to fix)");
    await db.$disconnect();
    return;
  }

  // Reversibility.
  const originals = await db.track.findMany({
    where: { id: { in: changes.map((c) => c.id) } },
    select: { id: true, title: true, primaryArtist: { select: { name: true } }, album: { select: { title: true } } },
  });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(originals, null, 2));

  const staleArtistIds = new Set<string>();
  for (const c of changes) {
    const t = await db.track.findUnique({ where: { id: c.id }, select: { primaryArtistId: true, albumId: true } });
    if (!t) continue;
    staleArtistIds.add(t.primaryArtistId);

    const artist = await db.artist.upsert({
      where: { name: c.after },
      create: { name: c.after },
      update: {},
      select: { id: true },
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
      create: { title: "YouTube", artistId: artist.id },
      update: {},
      select: { id: true },
    });
    await db.trackArtist.deleteMany({ where: { trackId: c.id } });
    await db.track.update({
      where: { id: c.id },
      data: { title: c.newTitle, primaryArtistId: artist.id, albumId: album.id },
    });
    console.log(`✓ ${c.before} → ${c.after}  ("${c.newTitle}")`);
  }

  // Drop channels left with nothing.
  for (const id of staleArtistIds) {
    await db.album.deleteMany({ where: { artistId: id, tracks: { none: {} } } });
    const still = await db.artist.findUnique({
      where: { id },
      select: { name: true, _count: { select: { tracks: true, albums: true, trackArtists: true } } },
    });
    if (still && still._count.tracks === 0 && still._count.albums === 0 && still._count.trackArtists === 0) {
      await db.artist.delete({ where: { id } });
      console.log(`  · removed orphaned label artist "${still.name}"`);
    }
  }

  console.log(`\n[fix-mv] done — ${changes.length} fixed (snapshot: ${SNAPSHOT})`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
