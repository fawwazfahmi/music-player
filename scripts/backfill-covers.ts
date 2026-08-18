// Backfill real cover art for in-library tracks that currently fall back to the
// YouTube thumbnail. Matches the (now-clean) artist+title to a MusicBrainz
// recording, pulls a release's Cover Art Archive image, and stores it at the
// TRACK level (so a shared "YouTube" album never bleeds one cover across songs).
// Guarded by match score. Usage: pnpm exec tsx --env-file=.env scripts/backfill-covers.ts
import { db } from "@/server/db";
import { searchRecording } from "@/server/services/musicbrainz";
import { fetchCoverArt } from "@/server/services/cover-art";

const MIN_SCORE = 80;
const MAX_RELEASES = 6;

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3));
}
function shareWord(a: string, b: string): boolean {
  const bw = words(b);
  for (const w of words(a)) if (bw.has(w)) return true;
  return false;
}

async function main() {
  const tracks = await db.track.findMany({
    where: {
      inLibrary: true,
      playable: true,
      coverArtHash: null,
      OR: [{ album: { is: { coverArtHash: null } } }, { album: { is: { title: "YouTube" } } }],
    },
    select: { id: true, title: true, primaryArtist: { select: { name: true } } },
    orderBy: { primaryArtist: { name: "asc" } },
  });
  console.log(`[covers] ${tracks.length} tracks without real art\n`);

  let set = 0;
  let missed = 0;
  for (const t of tracks) {
    const artist = t.primaryArtist.name;
    let hash: string | null = null;
    try {
      const results = await searchRecording(artist, t.title);
      const top = results[0];
      // Only trust a confident match whose title/artist actually overlap ours.
      if (
        top &&
        top.score >= MIN_SCORE &&
        shareWord(top.title, t.title) &&
        shareWord(top.artistName, artist)
      ) {
        for (const rel of top.releases.slice(0, MAX_RELEASES)) {
          const art = await fetchCoverArt(rel.mbid).catch(() => null);
          if (art) {
            hash = art.hash;
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`  ! ${artist} — ${t.title}:`, err instanceof Error ? err.message : err);
    }

    if (hash) {
      await db.track.update({ where: { id: t.id }, data: { coverArtHash: hash } });
      set++;
      console.log(`  ✓ ${artist} — ${t.title}`);
    } else {
      missed++;
    }
  }

  console.log(`\n[covers] done — set ${set}, no match ${missed}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
