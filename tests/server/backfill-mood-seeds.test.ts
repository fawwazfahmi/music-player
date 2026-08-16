import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("backfillMoodSeeds", () => {
  let trackIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "MoodBackfillTest" },
      create: { name: "MoodBackfillTest" },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 2; i++) {
      const t = await db.track.create({
        data: {
          title: `MoodBackfill ${i}`,
          duration: 100,
          filePath: `/tmp/moodbf-${Date.now()}-${i}.m4a`,
          sha256: `moodbf-${Date.now()}-${Math.random()}-${i}`,
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
      where: { name: "MoodBackfillTest" },
      select: { id: true },
    });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackMoodSeed.deleteMany({ where: { trackId: { in: ids } } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.artist.delete({ where: { id: artist.id } });
    }
  });

  it("runs the seeder over every unseeded track, counting seeded ones", async () => {
    const { backfillMoodSeeds } = await import("../../scripts/backfill-mood-seeds");
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    const chillId = (await getAllMoods()).find((m) => m.name === "chill")!.id;
    const testIds = new Set(trackIds);
    const seeder = vi.fn(async (trackId: string) => {
      if (!testIds.has(trackId)) return []; // never touch real tracks
      await db.trackMoodSeed.create({ data: { trackId, moodId: chillId, score: 0.5 } });
      return ["chill"];
    });
    const res = await backfillMoodSeeds({ seeder });
    expect(res.scanned).toBeGreaterThanOrEqual(2);
    expect(res.seeded).toBe(2);
    for (const id of trackIds) {
      expect(await db.trackMoodSeed.count({ where: { trackId: id } })).toBe(1);
    }
  });
});
