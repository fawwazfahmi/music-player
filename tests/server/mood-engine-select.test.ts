import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("selectMoodTracks", () => {
  let ids: Record<string, string> = {};
  let moodIds: Record<string, string> = {};

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    const moods = await getAllMoods();
    moodIds = Object.fromEntries(moods.map((m) => [m.name, m.id]));

    ids = {};
    // Three tracks with different chill seeds, each under its OWN artist so the
    // artist-diversity cap doesn't interfere with a pure-ranking assertion.
    for (const [key, chill] of [
      ["hi", 0.9],
      ["mid", 0.5],
      ["lo", 0.1],
    ] as const) {
      const artist = await db.artist.upsert({
        where: { name: `EngineTest-${key}` },
        create: { name: `EngineTest-${key}` },
        update: {},
      });
      const t = await db.track.create({
        data: {
          title: `Engine ${key}`,
          duration: 100,
          filePath: `/tmp/engine-${Date.now()}-${key}.m4a`,
          sha256: `engine-${Date.now()}-${Math.random()}-${key}`,
          primaryArtistId: artist.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      ids[key] = t.id;
      await db.trackMoodSeed.create({
        data: { trackId: t.id, moodId: moodIds.chill!, score: chill },
      });
    }
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artists = await db.artist.findMany({
      where: { name: { startsWith: "EngineTest-" } },
      select: { id: true },
    });
    const aids = artists.map((a) => a.id);
    const tracks = await db.track.findMany({
      where: { primaryArtistId: { in: aids } },
      select: { id: true },
    });
    const tids = tracks.map((t) => t.id);
    await db.trackMoodSeed.deleteMany({ where: { trackId: { in: tids } } });
    await db.trackMoodAffinity.deleteMany({ where: { trackId: { in: tids } } });
    await db.track.deleteMany({ where: { id: { in: tids } } });
    await db.artist.deleteMany({ where: { id: { in: aids } } });
  });

  it("ranks tracks by weighted mood affinity (seed), highest first", async () => {
    const { selectMoodTracks } = await import("@/server/services/mood-engine");
    const tracks = await selectMoodTracks({
      listener: "tester",
      weights: { chill: 1 },
      genreHints: [],
      limit: 500,
      rng: () => 0, // deterministic, no jitter
    });
    // Our three tracks should appear, ordered hi > mid > lo among themselves.
    const order = tracks.map((t) => t.id).filter((id) => Object.values(ids).includes(id));
    expect(order[0]).toBe(ids.hi!);
    expect(order.indexOf(ids.hi!)).toBeLessThan(order.indexOf(ids.mid!));
    expect(order.indexOf(ids.mid!)).toBeLessThan(order.indexOf(ids.lo!));
  });

  it("learned signal outweighs a low seed (thumbs up promotes)", async () => {
    const { db } = await import("@/server/db");
    // Give the low-seed track strong learned chill affinity for this listener.
    await db.trackMoodAffinity.create({
      data: {
        listener: "learner",
        trackId: ids.lo!,
        moodId: moodIds.chill!,
        thumbsUp: 20,
        completes: 20,
        score: 1,
      },
    });
    const { selectMoodTracks } = await import("@/server/services/mood-engine");
    const tracks = await selectMoodTracks({
      listener: "learner",
      weights: { chill: 1 },
      genreHints: [],
      limit: 500,
      rng: () => 0,
    });
    const order = tracks.map((t) => t.id).filter((id) => Object.values(ids).includes(id));
    // lo now beats mid for this listener thanks to learned signal.
    expect(order.indexOf(ids.lo!)).toBeLessThan(order.indexOf(ids.mid!));
  });

  it("respects the limit", async () => {
    const { selectMoodTracks } = await import("@/server/services/mood-engine");
    const tracks = await selectMoodTracks({
      listener: "tester",
      weights: { chill: 1 },
      genreHints: [],
      limit: 2,
      rng: () => 0,
    });
    expect(tracks.length).toBeLessThanOrEqual(2);
  });
});
