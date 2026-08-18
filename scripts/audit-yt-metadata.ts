// Audit in-library YouTube tracks against their ALREADY-STORED titles (no
// re-fetch — the raw YouTube title reintroduces channel names + junk). Safe
// rules only:
//   • artist changes ONLY when the stored title has a hard quote pattern
//     (ARTIST 'Song') — separator-form titles were already artist-extracted.
//   • titles: extract the quoted song, else strip trailing noise (keeps markers).
// Dry run; writes scripts/.yt-audit.json for a follow-up apply.
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { parseYtTitle, stripTitleNoise, QUOTED_RE } from "@/server/services/yt-title-parser";

const OUT = path.join(process.cwd(), "scripts", ".yt-audit.json");

async function main() {
  const tracks = await db.track.findMany({
    where: { inLibrary: true, playable: true, ytVideoId: { not: null } },
    select: { id: true, ytVideoId: true, title: true, primaryArtist: { select: { name: true } } },
    orderBy: { primaryArtist: { name: "asc" } },
  });

  const changes: {
    id: string;
    videoId: string;
    curArtist: string;
    curTitle: string;
    newArtist: string;
    newTitle: string;
    artistChanged: boolean;
    titleChanged: boolean;
  }[] = [];

  for (const t of tracks) {
    const T = t.title;
    const A = t.primaryArtist.name;
    const hasQuote = QUOTED_RE.test(T);
    const parsed = parseYtTitle(T, A);
    const newArtist = hasQuote ? parsed.artist : A;
    const newTitle = hasQuote ? parsed.title : stripTitleNoise(T);
    const artistChanged = newArtist.toLowerCase() !== A.toLowerCase() && newArtist.length > 1;
    const titleChanged = newTitle !== T && newTitle.length > 0;
    if (artistChanged || titleChanged) {
      changes.push({
        id: t.id,
        videoId: t.ytVideoId!,
        curArtist: A,
        curTitle: T,
        newArtist,
        newTitle,
        artistChanged,
        titleChanged,
      });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(changes, null, 2));
  const artistFixes = changes.filter((c) => c.artistChanged);
  const titleOnly = changes.filter((c) => !c.artistChanged && c.titleChanged);

  console.log(`\n===== ARTIST CHANGES (${artistFixes.length}) =====`);
  for (const c of artistFixes) {
    console.log(`  ${c.curArtist}  →  ${c.newArtist}    |  "${c.curTitle}"  →  "${c.newTitle}"`);
  }
  console.log(`\n===== TITLE-ONLY CLEANUPS (${titleOnly.length}) =====`);
  for (const c of titleOnly) console.log(`  [${c.newArtist}]  "${c.curTitle}"  →  "${c.newTitle}"`);
  console.log(`\n[audit] ${changes.length} proposed → ${OUT}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
