import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("seedTrackMoodAffinities", () => {
  let trackId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "MoodSeedTest" },
      create: { name: "MoodSeedTest" },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "Seed Song",
        duration: 100,
        filePath: `/tmp/moodseed-${Date.now()}.m4a`,
        sha256: `moodseed-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
    // give it a genre for the heuristic path
    const genre = await db.genre.upsert({
      where: { name: "dark wave" },
      create: { name: "dark wave" },
      update: {},
      select: { id: true },
    });
    await db.trackGenre.create({ data: { trackId, genreId: genre.id } });
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.findUnique({
      where: { name: "MoodSeedTest" },
      select: { id: true },
    });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackMoodSeed.deleteMany({ where: { trackId: { in: ids } } });
      await db.trackGenre.deleteMany({ where: { trackId: { in: ids } } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.artist.delete({ where: { id: artist.id } });
    }
    // NOTE: "dark wave" is a real library genre — never delete it here. The
    // test only borrows it via upsert; its own link is removed with the track.
  });

  it("writes LLM seed scores (mapped mood name → id)", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const applied = await seedTrackMoodAffinities(trackId, {
      seedTrackMoods: vi.fn(async () => ({ chill: 0.8, nostalgic: 0.5 })),
      analyzeEnergy: async () => null,
    });
    expect(applied.sort()).toEqual(["chill", "nostalgic"]);
    const { db } = await import("@/server/db");
    const rows = await db.trackMoodSeed.findMany({
      where: { trackId },
      select: { score: true, source: true, mood: { select: { name: true } } },
    });
    const byMood = Object.fromEntries(rows.map((r) => [r.mood.name, r]));
    const chill = byMood.chill!;
    expect(chill.score).toBeCloseTo(0.8);
    expect(chill.source).toBe("LLM_SEED");
  });

  it("falls back to the genre heuristic when the LLM returns nothing", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const applied = await seedTrackMoodAffinities(trackId, {
      seedTrackMoods: vi.fn(async () => ({})),
      analyzeEnergy: async () => null,
    });
    expect(applied).toContain("nostalgic"); // dark wave → nostalgic
    const { db } = await import("@/server/db");
    const row = await db.trackMoodSeed.findFirst({
      where: { trackId, mood: { name: "nostalgic" } },
      select: { source: true },
    });
    expect(row?.source).toBe("HEURISTIC");
  });

  it("falls back to the heuristic when the LLM returns all-zero scores", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const applied = await seedTrackMoodAffinities(trackId, {
      seedTrackMoods: vi.fn(async () => ({ chill: 0, happy: 0, energetic: 0 })),
      analyzeEnergy: async () => null,
    });
    // dark wave → nostalgic via heuristic, since the LLM gave nothing usable
    expect(applied).toContain("nostalgic");
    const { db } = await import("@/server/db");
    const row = await db.trackMoodSeed.findFirst({
      where: { trackId, mood: { name: "nostalgic" } },
      select: { source: true },
    });
    expect(row?.source).toBe("HEURISTIC");
  });

  it("is idempotent — a second run adds nothing", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const deps = {
      seedTrackMoods: vi.fn(async () => ({ chill: 0.8 })),
      analyzeEnergy: async () => null,
    };
    await seedTrackMoodAffinities(trackId, deps);
    const second = await seedTrackMoodAffinities(trackId, deps);
    expect(second).toEqual([]);
    const { db } = await import("@/server/db");
    expect(await db.trackMoodSeed.count({ where: { trackId } })).toBe(1);
  });

  it("force re-seeds, replacing existing seeds", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const { db } = await import("@/server/db");
    await seedTrackMoodAffinities(trackId, {
      seedTrackMoods: vi.fn(async () => ({ chill: 0.8 })),
      analyzeEnergy: async () => null,
    });
    const applied = await seedTrackMoodAffinities(trackId, {
      seedTrackMoods: vi.fn(async () => ({ energetic: 0.9 })),
      analyzeEnergy: async () => null,
      force: true,
    });
    expect(applied).toEqual(["energetic"]);
    const names = (
      await db.trackMoodSeed.findMany({
        where: { trackId },
        select: { mood: { select: { name: true } } },
      })
    ).map((r) => r.mood.name);
    expect(names).toEqual(["energetic"]); // chill replaced
  });

  it("passes lyrics and energy to the seeder", async () => {
    const { seedTrackMoodAffinities } = await import("@/server/services/mood-seeder");
    const { db } = await import("@/server/db");
    await db.track.update({ where: { id: trackId }, data: { lyricsPlain: "so lonely tonight" } });
    const seedTrackMoods = vi.fn(
      async (_input: { lyrics?: string; energy?: number }, _moods: string[]) => ({ sad: 0.9 }),
    );
    await seedTrackMoodAffinities(trackId, {
      seedTrackMoods,
      analyzeEnergy: async () => 0.15,
      force: true,
    });
    const arg = seedTrackMoods.mock.calls[0]![0];
    expect(arg.lyrics).toContain("lonely");
    expect(arg.energy).toBe(0.15);
  });
});
