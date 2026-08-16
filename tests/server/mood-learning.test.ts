import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeLearnedScore } from "@/server/services/mood-learning";

describe("computeLearnedScore", () => {
  it("is 0.5 with no signal", () => {
    expect(
      computeLearnedScore({ completes: 0, skips: 0, replays: 0, thumbsUp: 0, thumbsDown: 0 }),
    ).toBeCloseTo(0.5);
  });
  it("rises with positive signal", () => {
    expect(
      computeLearnedScore({ completes: 5, skips: 0, replays: 3, thumbsUp: 4, thumbsDown: 0 }),
    ).toBeGreaterThan(0.8);
  });
  it("falls with negative signal", () => {
    expect(
      computeLearnedScore({ completes: 0, skips: 5, replays: 0, thumbsUp: 0, thumbsDown: 4 }),
    ).toBeLessThan(0.2);
  });
});

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("applyMoodSignal", () => {
  let trackId = "";
  let sessionId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "LearnTest" },
      create: { name: "LearnTest" },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "Learn Song",
        duration: 100,
        filePath: `/tmp/learn-${Date.now()}.m4a`,
        sha256: `learn-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
    const session = await db.moodSession.create({
      data: {
        listener: "learner",
        freeText: "test",
        interpretation: { weights: { chill: 1 }, genreHints: [] },
      },
      select: { id: true },
    });
    sessionId = session.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.moodFeedback.deleteMany({ where: { sessionId } });
    await db.moodSession.deleteMany({ where: { id: sessionId } });
    const artist = await db.artist.findUnique({
      where: { name: "LearnTest" },
      select: { id: true },
    });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackMoodAffinity.deleteMany({ where: { trackId: { in: ids } } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.artist.delete({ where: { id: artist.id } });
    }
  });

  it("thumbUp increments the counter, sets a high score, and logs FIT feedback", async () => {
    const { applyMoodSignal } = await import("@/server/services/mood-learning");
    await applyMoodSignal({ sessionId, trackId, signal: "thumbUp" });
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    const chillId = (await getAllMoods()).find((m) => m.name === "chill")!.id;
    const aff = await db.trackMoodAffinity.findUnique({
      where: {
        listener_trackId_moodId: { listener: "learner", trackId, moodId: chillId },
      },
    });
    expect(aff?.thumbsUp).toBe(1);
    expect(aff!.score).toBeGreaterThan(0.5);
    const fb = await db.moodFeedback.findMany({ where: { sessionId, trackId } });
    expect(fb).toHaveLength(1);
    expect(fb[0]!.verdict).toBe("FIT");
  });

  it("thumbDown lowers the score and logs MISS", async () => {
    const { applyMoodSignal } = await import("@/server/services/mood-learning");
    await applyMoodSignal({ sessionId, trackId, signal: "thumbDown" });
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    const chillId = (await getAllMoods()).find((m) => m.name === "chill")!.id;
    const aff = await db.trackMoodAffinity.findUnique({
      where: { listener_trackId_moodId: { listener: "learner", trackId, moodId: chillId } },
    });
    expect(aff?.thumbsDown).toBe(1);
    expect(aff!.score).toBeLessThan(0.5);
    const fb = await db.moodFeedback.findFirst({ where: { sessionId, trackId } });
    expect(fb?.verdict).toBe("MISS");
  });

  it("passive complete/skip update counters without logging feedback", async () => {
    const { applyMoodSignal } = await import("@/server/services/mood-learning");
    await applyMoodSignal({ sessionId, trackId, signal: "complete" });
    await applyMoodSignal({ sessionId, trackId, signal: "skip" });
    const { db } = await import("@/server/db");
    const { getAllMoods } = await import("@/server/services/mood-store");
    const chillId = (await getAllMoods()).find((m) => m.name === "chill")!.id;
    const aff = await db.trackMoodAffinity.findUnique({
      where: { listener_trackId_moodId: { listener: "learner", trackId, moodId: chillId } },
    });
    expect(aff?.completes).toBe(1);
    expect(aff?.skips).toBe(1);
    expect(await db.moodFeedback.count({ where: { sessionId } })).toBe(0);
  });
});
