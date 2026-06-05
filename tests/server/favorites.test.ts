import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("favorites actions", () => {
  let trackId = "";
  let artistId = "";
  let albumId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "FavTest" },
      create: { name: "FavTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "FavAlbum" } },
      create: { title: "FavAlbum", artistId: artist.id },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "FavTrack",
        duration: 100,
        filePath: `/tmp/fav-${Date.now()}.m4a`,
        sha256: `fav-sha-${Date.now()}`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
    artistId = artist.id;
    albumId = album.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.favoriteTrack.deleteMany({ where: { trackId } });
    await db.favoriteAlbum.deleteMany({ where: { albumId } });
    await db.favoriteArtist.deleteMany({ where: { artistId } });
    await db.track.deleteMany({ where: { id: trackId } });
    await db.album.deleteMany({ where: { id: albumId } });
    await db.artist.deleteMany({ where: { id: artistId } });
  });

  it("toggleFavorite(track) adds then removes", async () => {
    const { toggleFavorite, isFavorited } = await import("@/server/actions/favorites");
    expect(await isFavorited("TRACK", trackId)).toBe(false);
    expect(await toggleFavorite("TRACK", trackId)).toBe(true);
    expect(await isFavorited("TRACK", trackId)).toBe(true);
    expect(await toggleFavorite("TRACK", trackId)).toBe(false);
    expect(await isFavorited("TRACK", trackId)).toBe(false);
  });

  it("toggleFavorite works for artist + album", async () => {
    const { toggleFavorite } = await import("@/server/actions/favorites");
    expect(await toggleFavorite("ARTIST", artistId)).toBe(true);
    expect(await toggleFavorite("ALBUM", albumId)).toBe(true);
  });

  it("getFavoriteTracks returns favorited rows newest-first", async () => {
    const { toggleFavorite, getFavoriteTracks } = await import("@/server/actions/favorites");
    await toggleFavorite("TRACK", trackId);
    const list = await getFavoriteTracks();
    expect(list.some((f) => f.track.id === trackId)).toBe(true);
  });
});
