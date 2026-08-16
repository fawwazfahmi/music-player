import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("suggestYtForMood", () => {
  let inLibVideoId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "MoodYtTest" },
      create: { name: "MoodYtTest" },
      update: {},
    });
    inLibVideoId = `inlib-${Date.now()}`;
    await db.track.create({
      data: {
        title: "Already Here",
        duration: 100,
        ytVideoId: inLibVideoId,
        sha256: `moodyt-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        source: "YT_CACHED",
      },
    });
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.findUnique({
      where: { name: "MoodYtTest" },
      select: { id: true },
    });
    if (artist) {
      await db.track.deleteMany({ where: { primaryArtistId: artist.id } });
      await db.artist.delete({ where: { id: artist.id } });
    }
  });

  it("returns fresh picks, excluding videos already in the library", async () => {
    const { suggestYtForMood } = await import("@/server/services/mood-yt");
    const searchYt = vi.fn(async (_query: string, _limit?: number) => [
      { videoId: inLibVideoId, title: "Already Here", uploader: "x", duration: 100, thumbnail: null },
      { videoId: "fresh1", title: "New A", uploader: "y", duration: 120, thumbnail: null },
      { videoId: "fresh2", title: "New B", uploader: "z", duration: 130, thumbnail: null },
    ]);
    const picks = await suggestYtForMood(
      { moodLabel: "Chill", genreHints: ["lo-fi"], limit: 4 },
      { searchYt },
    );
    const ids = picks.map((p) => p.videoId);
    expect(ids).toContain("fresh1");
    expect(ids).toContain("fresh2");
    expect(ids).not.toContain(inLibVideoId); // already in library, filtered out
    // Query should reflect the mood + genre hint.
    const q = (searchYt.mock.calls[0]![0] as string).toLowerCase();
    expect(q).toContain("chill");
    expect(q).toContain("lo-fi");
  });

  it("returns [] gracefully when search yields nothing", async () => {
    const { suggestYtForMood } = await import("@/server/services/mood-yt");
    const picks = await suggestYtForMood(
      { moodLabel: "Focus", genreHints: [], limit: 4 },
      { searchYt: vi.fn(async () => []) },
    );
    expect(picks).toEqual([]);
  });
});
