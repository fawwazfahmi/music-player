import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("runMoodSession", () => {
  let trackId = "";
  let chillId = "";
  const sessionIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    chillId = (await getAllMoods()).find((m) => m.name === "chill")!.id;
    const artist = await db.artist.upsert({
      where: { name: "SessionTest" },
      create: { name: "SessionTest" },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "Session Song",
        duration: 100,
        filePath: `/tmp/session-${Date.now()}.m4a`,
        sha256: `session-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
    await db.trackMoodSeed.create({ data: { trackId, moodId: chillId, score: 0.95 } });
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.moodSession.deleteMany({ where: { id: { in: sessionIds } } });
    sessionIds.length = 0;
    const artist = await db.artist.findUnique({
      where: { name: "SessionTest" },
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

  it("builds a playlist for a chip mood and persists the session", async () => {
    const { runMoodSession } = await import("@/server/services/mood-session");
    const r = await runMoodSession({ listener: "sess", moodId: chillId, limit: 100 });
    sessionIds.push(r.sessionId);
    expect(r.moodLabel).toBe("Chill");
    expect(r.tracks.some((t) => t.id === trackId)).toBe(true);
    const { db } = await import("@/server/db");
    const row = await db.moodSession.findUnique({ where: { id: r.sessionId } });
    expect(row?.moodId).toBe(chillId);
    expect(row?.listener).toBe("sess");
  });

  it("interprets free text via the injected interpreter and stores it", async () => {
    const { runMoodSession } = await import("@/server/services/mood-session");
    const interpretMood = vi.fn(async () => ({
      weights: { chill: 0.9 },
      genreHints: ["lo-fi"],
      energy: "low" as const,
    }));
    const r = await runMoodSession({
      listener: "sess",
      freeText: "rainy sunday",
      limit: 100,
      deps: { interpretMood },
    });
    sessionIds.push(r.sessionId);
    expect(interpretMood).toHaveBeenCalledOnce();
    expect(r.moodLabel).toBe("rainy sunday");
    expect(r.weights.chill).toBe(0.9);
    const { db } = await import("@/server/db");
    const row = await db.moodSession.findUnique({ where: { id: r.sessionId } });
    expect(row?.freeText).toBe("rainy sunday");
  });
});
