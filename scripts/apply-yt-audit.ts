// Apply the approved YouTube metadata cleanup: the auto audit (.yt-audit.json),
// the manual artist fixes, and the Mr. Kitty → Mr.Kitty merge. Snapshots first.
// Usage: pnpm exec tsx --env-file=.env scripts/apply-yt-audit.ts
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";

const AUDIT = path.join(process.cwd(), "scripts", ".yt-audit.json");
const SNAPSHOT = path.join(process.cwd(), "scripts", ".yt-audit-snapshot.json");

const staleArtistIds = new Set<string>();

/** Update a track's title and/or reattach its primary artist (moving it to that
    artist's "YouTube" album). Only touches what's provided. */
async function reassign(trackId: string, opts: { artist?: string; title?: string }) {
  const t = await db.track.findUnique({
    where: { id: trackId },
    select: { id: true, title: true, primaryArtistId: true, primaryArtist: { select: { name: true } } },
  });
  if (!t) return;

  if (opts.title && opts.title !== t.title) {
    await db.track.update({ where: { id: trackId }, data: { title: opts.title } });
  }

  if (opts.artist && opts.artist.toLowerCase() !== t.primaryArtist.name.toLowerCase()) {
    staleArtistIds.add(t.primaryArtistId);
    const artist = await db.artist.upsert({
      where: { name: opts.artist },
      create: { name: opts.artist },
      update: {},
      select: { id: true },
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
      create: { title: "YouTube", artistId: artist.id },
      update: {},
      select: { id: true },
    });
    await db.trackArtist.deleteMany({ where: { trackId } });
    await db.track.update({ where: { id: trackId }, data: { primaryArtistId: artist.id, albumId: album.id } });
  }
}

// Manual artist fixes (channel/swap cases the auto-audit can't detect), by id.
const MANUAL: { id: string; artist: string; title: string }[] = [
  { id: "cmsvmaqsq00182wny1rbzrviy", artist: "KISS OF LIFE", title: "Igloo" },
  { id: "cmsuu66uv00a4o5nylpr33b45", artist: "Nirvana", title: "Lithium" },
  { id: "cmsvxepqe001rvgnyg0w9fz8q", artist: "BABYMONSTER", title: "WE GO UP" },
  { id: "cmr3sc6ev0020c9nyyefpp5qa", artist: "Gary Moore", title: "Still Got The Blues" },
  { id: "cmsuvp4km00bpo5ny9usi2t3h", artist: "LeAnn Rimes", title: "How Do I Live" },
  { id: "cmsuswydz008qo5ny744ky38c", artist: "Skeeter Davis", title: "Mine Is A Lonely Life" },
  { id: "cmsut1pgl0090o5nylglwj100", artist: "The Band", title: "The Weight" },
  { id: "cmsvm4wyf00022wnyfdajk6h4", artist: "Mr.Kitty", title: "Habits" },
];

// Mr. Kitty (2 tracks, my earlier fix) → merge into canonical Mr.Kitty.
const MRKITTY_DUP = "Mr. Kitty";
const MRKITTY_CANON = "Mr.Kitty";

async function main() {
  const audit: { id: string; newArtist: string; newTitle: string; artistChanged: boolean; titleChanged: boolean }[] =
    JSON.parse(fs.readFileSync(AUDIT, "utf8"));

  const allIds = new Set<string>([...audit.map((a) => a.id), ...MANUAL.map((m) => m.id)]);
  const dupTracks = await db.track.findMany({ where: { primaryArtist: { name: MRKITTY_DUP } }, select: { id: true } });
  dupTracks.forEach((t) => allIds.add(t.id));

  // Snapshot originals.
  const originals = await db.track.findMany({
    where: { id: { in: [...allIds] } },
    select: { id: true, title: true, primaryArtist: { select: { name: true } }, album: { select: { title: true } } },
  });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(originals, null, 2));

  // 1. Auto audit.
  for (const c of audit) {
    await reassign(c.id, {
      artist: c.artistChanged ? c.newArtist : undefined,
      title: c.titleChanged ? c.newTitle : undefined,
    });
  }
  console.log(`✓ applied ${audit.length} auto changes`);

  // 2. Manual fixes.
  for (const m of MANUAL) await reassign(m.id, { artist: m.artist, title: m.title });
  console.log(`✓ applied ${MANUAL.length} manual artist fixes`);

  // 3. Merge Mr. Kitty → Mr.Kitty.
  for (const t of dupTracks) await reassign(t.id, { artist: MRKITTY_CANON });
  console.log(`✓ merged ${dupTracks.length} "Mr. Kitty" tracks into "${MRKITTY_CANON}"`);

  // Orphan cleanup: drop empty albums then artists left with nothing.
  for (const id of staleArtistIds) {
    await db.album.deleteMany({ where: { artistId: id, tracks: { none: {} } } });
    const still = await db.artist.findUnique({
      where: { id },
      select: { name: true, _count: { select: { tracks: true, albums: true, trackArtists: true } } },
    });
    if (still && still._count.tracks === 0 && still._count.albums === 0 && still._count.trackArtists === 0) {
      await db.artist.delete({ where: { id } });
      console.log(`  · removed orphaned artist "${still.name}"`);
    }
  }

  console.log(`\n[apply] done (snapshot: ${SNAPSHOT})`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
