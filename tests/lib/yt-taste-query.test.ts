import { describe, expect, it } from "vitest";
import { buildTasteQueries, interleaveFresh, topArtists } from "@/lib/yt-taste-query";
import type { YtSearchResult } from "@/server/services/yt-service";

const r = (videoId: string, uploader: string): YtSearchResult => ({
  videoId,
  title: videoId,
  uploader,
  duration: 1,
  thumbnail: "",
});

describe("topArtists", () => {
  it("takes distinct artists in order, capped", () => {
    expect(
      topArtists(
        [{ artist: "Mr. Kitty" }, { artist: "Mr. Kitty" }, { artist: "Cavetown" }, { artist: "VÖJ" }, { artist: "X" }],
        3,
      ),
    ).toEqual(["Mr. Kitty", "Cavetown", "VÖJ"]);
  });
});

describe("buildTasteQueries", () => {
  it("emits artist+mood, genre+mood, and a generic backstop", () => {
    expect(
      buildTasteQueries({ moodLabel: "chill", seedArtists: ["Mr. Kitty"], seedGenres: ["darkwave"] }),
    ).toEqual(["Mr. Kitty chill", "darkwave chill music", "chill music"]);
  });
  it("degrades to just the generic query with no seeds", () => {
    expect(buildTasteQueries({ moodLabel: "chill", seedArtists: [], seedGenres: [] })).toEqual([
      "chill music",
    ]);
  });
});

describe("interleaveFresh", () => {
  it("round-robins across lists, first-seen wins, drops downranked, caps at limit", () => {
    const out = interleaveFresh(
      [[r("a", "Mr. Kitty"), r("b", "Mr. Kitty")], [r("c", "Someone"), r("a", "Mr. Kitty")], [r("d", "BadGuy")]],
      { limit: 3, excludeVideoIds: new Set(), downrankArtists: ["BadGuy"] },
    );
    expect(out.map((x) => x.videoId)).toEqual(["a", "c", "b"]);
  });

  it("drops excluded videoIds and stops when fresh runs out", () => {
    const out = interleaveFresh(
      [[r("a", "Mr. Kitty"), r("b", "Mr. Kitty")], [r("c", "Someone")], [r("d", "BadGuy")]],
      { limit: 5, excludeVideoIds: new Set(["b"]), downrankArtists: ["BadGuy"] },
    );
    expect(out.map((x) => x.videoId)).toEqual(["a", "c"]);
  });
});
