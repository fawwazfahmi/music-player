import { describe, expect, it } from "vitest";
import { buildLyricsQueries } from "@/server/services/lyrics-query";

describe("buildLyricsQueries", () => {
  it("prefers the romanized/English name inside parens for a CJK title", () => {
    const q = buildLyricsQueries("2NE1", "내가 제일 잘 나가(I AM THE BEST) M/V");
    // First candidate is what LRCLIB actually matches on.
    expect(q[0]).toEqual({ artist: "2NE1", title: "I AM THE BEST" });
    // The raw title is still kept as a later fallback.
    expect(q.map((c) => c.title)).toContain("내가 제일 잘 나가(I AM THE BEST) M/V");
  });

  it("strips M/V and video noise from an otherwise clean title", () => {
    const q = buildLyricsQueries("TWICE", "Strategy M/V");
    expect(q[0]).toEqual({ artist: "TWICE", title: "Strategy" });
  });

  it("leaves a plain Latin title untouched as the only query", () => {
    const q = buildLyricsQueries("Radiohead", "Karma Police");
    expect(q).toEqual([{ artist: "Radiohead", title: "Karma Police" }]);
  });

  it("drops a redundant native-script artist tag", () => {
    const q = buildLyricsQueries("aespa 에스파", "Armageddon");
    expect(q[0]).toEqual({ artist: "aespa", title: "Armageddon" });
  });

  it("keeps a purely CJK title as a query (LRCLIB may match hangul)", () => {
    const q = buildLyricsQueries("BABYMONSTER", "춤 (CHOOM)");
    // English paren first, hangul kept as fallback.
    expect(q[0]).toEqual({ artist: "BABYMONSTER", title: "CHOOM" });
    expect(q.map((c) => c.title)).toContain("춤 (CHOOM)");
  });

  it("never emits empty or duplicate queries", () => {
    const q = buildLyricsQueries("X", "Song (Official Video)");
    const titles = q.map((c) => c.title);
    expect(titles).not.toContain("");
    expect(new Set(titles).size).toBe(titles.length);
  });
});
