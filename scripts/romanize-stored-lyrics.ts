// Transliterate any already-stored lyrics that are still in CJK script into
// romaji/romanization in place (no re-fetch — just run the romanizer over what's
// stored). Needed for tracks whose lyrics were saved before romanization was
// added to the pipeline. Snapshots first.
// Usage: pnpm exec tsx --env-file=.env scripts/romanize-stored-lyrics.ts
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { containsCJK, romanizeLyrics } from "@/server/services/romanize";

const SNAPSHOT = path.join(process.cwd(), "scripts", ".romanize-lyrics-snapshot.json");

async function main() {
  const withLyrics = await db.track.findMany({
    where: { OR: [{ lyricsSynced: { not: null } }, { lyricsPlain: { not: null } }] },
    select: { id: true, title: true, lyricsSynced: true, lyricsPlain: true, primaryArtist: { select: { name: true } } },
  });

  const targets = withLyrics.filter(
    (t) => (t.lyricsSynced && containsCJK(t.lyricsSynced)) || (t.lyricsPlain && containsCJK(t.lyricsPlain)),
  );
  fs.writeFileSync(SNAPSHOT, JSON.stringify(targets, null, 2));
  console.log(`[romanize] ${targets.length} tracks with CJK lyrics → snapshot ${SNAPSHOT}\n`);

  for (const t of targets) {
    const synced = t.lyricsSynced ? romanizeLyrics(t.lyricsSynced) : t.lyricsSynced;
    const plain = t.lyricsPlain ? romanizeLyrics(t.lyricsPlain) : t.lyricsPlain;
    await db.track.update({ where: { id: t.id }, data: { lyricsSynced: synced, lyricsPlain: plain } });
    console.log(`  ✓ ${t.primaryArtist.name} — ${t.title}`);
  }

  console.log(`\n[romanize] done — ${targets.length} romanized`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
