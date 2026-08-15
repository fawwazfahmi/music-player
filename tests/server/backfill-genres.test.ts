import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("backfillGenres", () => {
  let trackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "BackfillTest" },
      create: { name: "BackfillTest" },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 2; i++) {
      const t = await db.track.create({
        data: {
          title: `Backfill ${i}`,
          duration: 100,
          filePath: `/tmp/backfill-${Date.now()}-${i}.m4a`,
          sha256: `backfill-${Date.now()}-${Math.random()}-${i}`,
          primaryArtistId: artist.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.findUnique({
      where: { name: "BackfillTest" },
      select: { id: true },
    });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackGenre.deleteMany({ where: { trackId: { in: ids } } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.artist.delete({ where: { id: artist.id } });
    }
    await db.genre.deleteMany({ where: { name: "test-genre" } });
  });

  it("runs the tagger over every ungenred track and counts the ones tagged", async () => {
    const { backfillGenres } = await import("../../scripts/backfill-genres");
    const { db } = await import("@/server/db");
    // Backfill scans the WHOLE library, so scope the fake tagger to this test's
    // own tracks — return [] for any real library track so we never touch them.
    const testIds = new Set(trackIds);
    const tagger = vi.fn(async (trackId: string) => {
      if (!testIds.has(trackId)) return [];
      const g = await db.genre.upsert({
        where: { name: "test-genre" },
        create: { name: "test-genre" },
        update: {},
        select: { id: true },
      });
      await db.trackGenre.create({ data: { trackId, genreId: g.id } });
      return ["test-genre"];
    });
    const res = await backfillGenres({ tagger });
    // Every ungenred track was visited; exactly our two got tagged.
    expect(res.scanned).toBeGreaterThanOrEqual(2);
    expect(res.tagged).toBe(2);
    expect(tagger).toHaveBeenCalledTimes(res.scanned);
    for (const id of trackIds) {
      expect(await db.trackGenre.count({ where: { trackId: id } })).toBe(1);
    }
  });
});
