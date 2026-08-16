import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { suggestYtForMood } from "@/server/services/mood-yt";
import type { YtSearchResult } from "@/server/services/yt-service";

const OWNED = "ztestOWN01";
let trackId: string;

const r = (videoId: string, uploader = "chan"): YtSearchResult => ({
  videoId,
  title: videoId,
  uploader,
  duration: 1,
  thumbnail: "",
});

beforeAll(async () => {
  const a = await db.artist.upsert({
    where: { name: "ztest-moodyt-artist" },
    create: { name: "ztest-moodyt-artist" },
    update: {},
  });
  const t = await db.track.create({
    data: { title: "ztest-moodyt-owned", duration: 1, primaryArtistId: a.id, ytVideoId: OWNED, inLibrary: true },
  });
  trackId = t.id;
});
afterAll(async () => {
  await db.track.deleteMany({ where: { id: trackId } });
  await db.artist.deleteMany({ where: { name: "ztest-moodyt-artist" } });
});

describe("suggestYtForMood (taste-seeded)", () => {
  it("issues taste queries and excludes in-library videos", async () => {
    const searchYt = vi.fn(async (q: string) => {
      if (q === "Mr. Kitty happy") return [r("n1"), r(OWNED)];
      if (q === "happy music") return [r("n2")];
      return [];
    });
    const out = await suggestYtForMood(
      { moodLabel: "happy", genreHints: [], seedArtists: ["Mr. Kitty"], limit: 4 },
      { searchYt },
    );
    const calls = searchYt.mock.calls.map((c) => c[0]);
    expect(calls).toContain("Mr. Kitty happy");
    expect(calls).toContain("happy music");
    const ids = out.map((x) => x.videoId);
    expect(ids).toContain("n1");
    expect(ids).toContain("n2");
    expect(ids).not.toContain(OWNED); // already in the library
  });

  it("cold start (no seeds) still searches the generic mood query", async () => {
    const searchYt = vi.fn(async (_q: string) => [r("g1")]);
    const out = await suggestYtForMood({ moodLabel: "happy", genreHints: [] }, { searchYt });
    expect(searchYt.mock.calls.map((c) => c[0])).toEqual(["happy music"]);
    expect(out.map((x) => x.videoId)).toEqual(["g1"]);
  });

  it("returns [] gracefully when every query yields nothing", async () => {
    const searchYt = vi.fn(async (_q: string) => [] as YtSearchResult[]);
    const out = await suggestYtForMood(
      { moodLabel: "chill", genreHints: ["lo-fi"], seedArtists: ["Mr. Kitty"] },
      { searchYt },
    );
    expect(out).toEqual([]);
  });
});
