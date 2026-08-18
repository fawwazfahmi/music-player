// Adopt the downloaded-but-hidden tracks (playable, inLibrary:false) into the
// library so they show in the songs list. Per user: keep everything, including
// duplicates — disambiguate colliding (artist, title) pairs by appending
// "(1)", "(2)", … to all but the oldest. Snapshots first.
// Usage: pnpm exec tsx --env-file=.env scripts/adopt-hidden.ts
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";

const SNAPSHOT = path.join(process.cwd(), "scripts", ".adopt-hidden-snapshot.json");

async function main() {
  const hidden = await db.track.findMany({
    where: { inLibrary: false, playable: true },
    select: { id: true, title: true, primaryArtist: { select: { name: true } } },
  });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(hidden, null, 2));
  console.log(`[adopt] ${hidden.length} hidden tracks → snapshot ${SNAPSHOT}\n`);

  // 1) Adopt them all.
  await db.track.updateMany({
    where: { id: { in: hidden.map((t) => t.id) } },
    data: { inLibrary: true },
  });
  for (const t of hidden) console.log(`  + ${t.primaryArtist.name} — ${t.title}`);

  // 2) Disambiguate title collisions across the WHOLE library (by artist +
  //    case-insensitive title). Oldest keeps its title; the rest get "(n)".
  const all = await db.track.findMany({
    where: { inLibrary: true },
    select: { id: true, title: true, primaryArtistId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof all>();
  for (const t of all) {
    const key = `${t.primaryArtistId}::${t.title.trim().toLowerCase()}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  let renamed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // group is already createdAt-asc; skip [0], number the rest.
    for (let i = 1; i < group.length; i++) {
      const t = group[i]!;
      if (/\(\d+\)$/.test(t.title.trim())) continue; // already suffixed
      const newTitle = `${t.title.trim()} (${i})`;
      await db.track.update({ where: { id: t.id }, data: { title: newTitle } });
      renamed++;
      console.log(`  ~ dedup: "${t.title}" → "${newTitle}"`);
    }
  }

  const total = await db.track.count({ where: { inLibrary: true, playable: true } });
  console.log(`\n[adopt] done — adopted ${hidden.length}, deduped ${renamed}. Library now ${total} playable.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
