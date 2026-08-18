import { describe, expect, it } from "vitest";
import { pickBestMatch } from "@/server/services/lrclib";

describe("pickBestMatch", () => {
  const A = { id: 1, duration: 210, syncedLyrics: "[00:01.00]a", plainLyrics: "a" };
  const B = { id: 2, duration: 320, syncedLyrics: "[00:01.00]wrong", plainLyrics: "wrong" };
  const plainOnly = { id: 3, duration: 211, plainLyrics: "p" };

  it("rejects a same-title match whose duration is way off", () => {
    // Only the 320s entry exists but we want a 210s song → no match.
    expect(pickBestMatch([B], 210)).toBeNull();
  });

  it("picks the duration-matching entry over a wrong-length one", () => {
    expect(pickBestMatch([B, A], 210)?.id).toBe(1);
  });

  it("prefers a synced match over a plain one within tolerance", () => {
    expect(pickBestMatch([plainOnly, A], 210)?.id).toBe(1);
  });

  it("skips entries with no lyrics at all", () => {
    const empty = { id: 9, duration: 210 };
    expect(pickBestMatch([empty], 210)).toBeNull();
  });

  it("falls back to the first lyric-bearing entry when duration is unknown", () => {
    expect(pickBestMatch([plainOnly, A])?.id).toBe(3);
  });
});
