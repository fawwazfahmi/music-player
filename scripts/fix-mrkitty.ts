// One-off data fix for two Mr. Kitty re-uploads whose stored artist was the
// re-upload channel (grounded in the real YouTube titles, read via yt-dlp):
//   DMu_6QXgFes  "Ｈｏｍｅ － Ｍｒ． Ｋｉｔｔｙ （Ｓｌｏｗｅｄ ＆ Ｒｅｖｅｒｂｅｄ）"
//   W-IzDrJRTo8  "in your arms — mr kitty (slowed & reverb)"
// MusicBrainz was too unreliable to do this automatically (see title-cleaner.ts),
// so these are corrected by hand. Snapshots originals first for reversibility.
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";

const SNAPSHOT = path.join(process.cwd(), "scripts", ".fix-mrkitty-snapshot.json");

const FIXES = [
  { ytVideoId: "DMu_6QXgFes", title: "Home (Slowed & Reverbed)", artist: "Mr. Kitty" },
  { ytVideoId: "W-IzDrJRTo8", title: "In Your Arms (Slowed & Reverb)", artist: "Mr. Kitty" },
];

async function main() {
  const originals: unknown[] = [];

  const kitty = await db.artist.upsert({
    where: { name: "Mr. Kitty" },
    create: { name: "Mr. Kitty" },
    update: {},
    select: { id: true },
  });
  const kittyAlbum = await db.album.upsert({
    where: { artistId_title: { artistId: kitty.id, title: "YouTube" } },
    create: { title: "YouTube", artistId: kitty.id },
    update: {},
    select: { id: true },
  });

  const staleArtistIds = new Set<string>();
  for (const f of FIXES) {
    const t = await db.track.findFirst({
      where: { ytVideoId: f.ytVideoId },
      select: {
        id: true,
        title: true,
        primaryArtistId: true,
        primaryArtist: { select: { name: true } },
        albumId: true,
        album: { select: { title: true } },
      },
    });
    if (!t) {
      console.warn(`! no track for ${f.ytVideoId} — skipping`);
      continue;
    }
    originals.push({
      id: t.id,
      ytVideoId: f.ytVideoId,
      title: t.title,
      primaryArtist: t.primaryArtist.name,
      album: t.album?.title ?? null,
    });
    if (t.primaryArtistId !== kitty.id) staleArtistIds.add(t.primaryArtistId);

    await db.trackArtist.deleteMany({ where: { trackId: t.id } });
    await db.track.update({
      where: { id: t.id },
      data: { title: f.title, primaryArtistId: kitty.id, albumId: kittyAlbum.id },
    });
    console.log(`✓ ${f.ytVideoId}: "${t.title}" — ${t.primaryArtist.name}  →  "${f.title}" — ${f.artist}`);
  }

  fs.writeFileSync(SNAPSHOT, JSON.stringify(originals, null, 2));

  // Clean up the channels left with nothing: drop their now-empty albums, then
  // the artist itself if it has no tracks and no albums left.
  for (const id of staleArtistIds) {
    await db.album.deleteMany({ where: { artistId: id, tracks: { none: {} } } });
    const still = await db.artist.findUnique({
      where: { id },
      select: { name: true, _count: { select: { tracks: true, albums: true, trackArtists: true } } },
    });
    if (still && still._count.tracks === 0 && still._count.albums === 0 && still._count.trackArtists === 0) {
      await db.artist.delete({ where: { id } });
      console.log(`  · removed orphaned channel artist "${still.name}"`);
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
