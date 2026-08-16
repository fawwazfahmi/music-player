import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("genre actions", () => {
  let trackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "GenTest" },
      create: { name: "GenTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "GenAlbum" } },
      create: { title: "GenAlbum", artistId: artist.id },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 2; i++) {
      const t = await db.track.create({
        data: {
          title: `GenTrack ${i}`,
          duration: 100,
          filePath: `/tmp/gentest-${Date.now()}-${i}.m4a`,
          sha256: `gentest-${Date.now()}-${Math.random()}-${i}`,
          primaryArtistId: artist.id,
          albumId: album.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    // Delete by the test artist rather than this run's ids, so a partial
    // failure mid-test can never strand FK-referencing rows.
    const artist = await db.artist.findUnique({ where: { name: "GenTest" }, select: { id: true } });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackGenre.deleteMany({ where: { trackId: { in: ids } } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.album.deleteMany({ where: { artistId: artist.id } });
      await db.artist.delete({ where: { id: artist.id } });
    }
    await db.genre.deleteMany({ where: { name: { in: ["zt indie rock", "zt-pop"] } } });
  });

  it("addGenreToTrack normalizes, dedupes, and is idempotent", async () => {
    const { addGenreToTrack, getGenresForTrack } = await import("@/server/actions/genres");
    await addGenreToTrack(trackIds[0]!, "Zt Indie  Rock");
    await addGenreToTrack(trackIds[0]!, "zt indie rock"); // same after normalize
    const genres = await getGenresForTrack(trackIds[0]!);
    expect(genres.map((g) => g.name)).toEqual(["zt indie rock"]);
  });

  it("getAllGenres reports per-genre track counts", async () => {
    const { addGenreToTrack, getAllGenres } = await import("@/server/actions/genres");
    await addGenreToTrack(trackIds[0]!, "zt-pop");
    await addGenreToTrack(trackIds[1]!, "zt-pop");
    const all = await getAllGenres();
    const pop = all.find((g) => g.name === "zt-pop");
    expect(pop?.trackCount).toBe(2);
  });

  it("getTracksByGenre returns playable tracks for the genre", async () => {
    const { addGenreToTrack, getTracksByGenre } = await import("@/server/actions/genres");
    const { db } = await import("@/server/db");
    await addGenreToTrack(trackIds[0]!, "zt-pop");
    const genre = await db.genre.findUnique({ where: { name: "zt-pop" }, select: { id: true } });
    const res = await getTracksByGenre(genre!.id);
    expect(res.genre?.name).toBe("zt-pop");
    expect(res.tracks.map((t) => t.id)).toContain(trackIds[0]);
  });

  it("removeGenreFromTrack drops the link and garbage-collects the empty genre", async () => {
    const { addGenreToTrack, removeGenreFromTrack, getGenresForTrack } = await import(
      "@/server/actions/genres"
    );
    const { db } = await import("@/server/db");
    const added = await addGenreToTrack(trackIds[0]!, "zt-pop");
    await removeGenreFromTrack(trackIds[0]!, added!.id);
    expect(await getGenresForTrack(trackIds[0]!)).toEqual([]);
    expect(await db.genre.findUnique({ where: { name: "zt-pop" } })).toBeNull();
  });
});
