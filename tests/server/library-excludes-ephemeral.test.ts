import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAllSongs, getArtists, getAllAlbums } from "@/server/actions/views";
import { getAllGenres } from "@/server/actions/genres";

// Two parallel little universes: one in-library, one ephemeral. Nothing from the
// ephemeral side should surface in any library list.
const LIB = {
  artist: "ztest-t3a-lib-artist",
  album: "ztest-t3a-lib-album",
  genre: "ztest-t3a-lib-genre",
  title: "ztest-t3a-lib-song",
};
const EPH = {
  artist: "ztest-t3a-eph-artist",
  album: "ztest-t3a-eph-album",
  genre: "ztest-t3a-eph-genre",
  title: "ztest-t3a-eph-song",
};
const trackIds: string[] = [];

async function seed(u: typeof LIB, inLibrary: boolean) {
  const artist = await db.artist.upsert({ where: { name: u.artist }, create: { name: u.artist }, update: {} });
  const album = await db.album.upsert({
    where: { artistId_title: { artistId: artist.id, title: u.album } },
    create: { title: u.album, artistId: artist.id },
    update: {},
  });
  const genre = await db.genre.upsert({ where: { name: u.genre }, create: { name: u.genre }, update: {} });
  const track = await db.track.create({
    data: {
      title: u.title,
      duration: 1,
      primaryArtistId: artist.id,
      albumId: album.id,
      playable: true,
      inLibrary,
    },
  });
  await db.trackGenre.create({ data: { trackId: track.id, genreId: genre.id } });
  trackIds.push(track.id);
  return track.id;
}

beforeAll(async () => {
  await seed(LIB, true);
  await seed(EPH, false);
});

afterAll(async () => {
  await db.trackGenre.deleteMany({ where: { trackId: { in: trackIds } } });
  await db.track.deleteMany({ where: { id: { in: trackIds } } });
  await db.album.deleteMany({ where: { title: { in: [LIB.album, EPH.album] } } });
  await db.genre.deleteMany({ where: { name: { in: [LIB.genre, EPH.genre] } } });
  await db.artist.deleteMany({ where: { name: { in: [LIB.artist, EPH.artist] } } });
});

describe("library lists exclude ephemeral tracks", () => {
  it("getAllSongs omits the ephemeral track", async () => {
    const titles = (await getAllSongs()).map((s) => s.title);
    expect(titles).toContain(LIB.title);
    expect(titles).not.toContain(EPH.title);
  });

  it("getArtists omits an ephemeral-only artist", async () => {
    const names = (await getArtists()).map((a) => a.name);
    expect(names).toContain(LIB.artist);
    expect(names).not.toContain(EPH.artist);
  });

  it("getAllAlbums omits an ephemeral-only album", async () => {
    const titles = (await getAllAlbums()).map((a) => a.title);
    expect(titles).toContain(LIB.album);
    expect(titles).not.toContain(EPH.album);
  });

  it("getAllGenres omits a genre held only by an ephemeral track", async () => {
    const names = (await getAllGenres()).map((g) => g.name);
    expect(names).toContain(LIB.genre);
    expect(names).not.toContain(EPH.genre);
  });
});
