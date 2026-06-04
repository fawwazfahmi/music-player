import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("search service", () => {
  let createdTrackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "SearchTest Artist" },
      create: { name: "SearchTest Artist" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "SearchTest Album" } },
      create: { title: "SearchTest Album", artistId: artist.id },
      update: {},
    });
    const t1 = await db.track.create({
      data: {
        title: "From The Start",
        duration: 200,
        filePath: `/tmp/searchtest-${Date.now()}-1.m4a`,
        sha256: `searchtest-sha-${Date.now()}-1`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    const t2 = await db.track.create({
      data: {
        title: "Unrelated Song",
        duration: 180,
        filePath: `/tmp/searchtest-${Date.now()}-2.m4a`,
        sha256: `searchtest-sha-${Date.now()}-2`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    createdTrackIds = [t1.id, t2.id];
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    await db.album.deleteMany({ where: { title: "SearchTest Album" } });
    await db.artist.deleteMany({ where: { name: "SearchTest Artist" } });
  });

  it("ranks fuzzy track matches above non-matches", async () => {
    const { searchLibrary } = await import("@/server/services/search");
    const result = await searchLibrary("from the strt"); // typo
    const titles = result.tracks.map((t) => t.title);
    expect(titles).toContain("From The Start");
  });

  it("returns matched artists and albums too", async () => {
    const { searchLibrary } = await import("@/server/services/search");
    const result = await searchLibrary("SearchTest");
    expect(result.artists.some((a) => a.name === "SearchTest Artist")).toBe(true);
    expect(result.albums.some((a) => a.title === "SearchTest Album")).toBe(true);
  });

  it("returns empty for empty query", async () => {
    const { searchLibrary } = await import("@/server/services/search");
    const result = await searchLibrary("");
    expect(result.tracks).toEqual([]);
    expect(result.artists).toEqual([]);
    expect(result.albums).toEqual([]);
  });
});
