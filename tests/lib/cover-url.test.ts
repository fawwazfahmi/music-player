import { describe, expect, it } from "vitest";
import { coverUrl, resolveTrackCoverHash } from "@/lib/cover-url";
import { isAllowedCoverHost } from "@/server/services/cover-candidates";

describe("resolveTrackCoverHash", () => {
  it("prefers the per-track override over album art", () => {
    expect(
      resolveTrackCoverHash({ trackCoverArtHash: "aaa", albumCoverArtHash: "bbb" }),
    ).toBe("aaa");
  });

  it("falls back to album art when there is no override", () => {
    expect(
      resolveTrackCoverHash({ trackCoverArtHash: null, albumCoverArtHash: "bbb" }),
    ).toBe("bbb");
  });

  it("returns null when neither is present", () => {
    expect(resolveTrackCoverHash({})).toBeNull();
    expect(
      resolveTrackCoverHash({ trackCoverArtHash: null, albumCoverArtHash: null }),
    ).toBeNull();
  });

  it("treats the legacy coverArtHash field as album-level", () => {
    // Existing callers pass `coverArtHash` meaning album art. It must rank
    // below a real per-track override, and above nothing.
    expect(
      resolveTrackCoverHash({ trackCoverArtHash: "aaa", legacyCoverArtHash: "ccc" }),
    ).toBe("aaa");
    expect(resolveTrackCoverHash({ legacyCoverArtHash: "ccc" })).toBe("ccc");
  });

  it("ignores empty strings, which are not valid hashes", () => {
    expect(
      resolveTrackCoverHash({ trackCoverArtHash: "", albumCoverArtHash: "bbb" }),
    ).toBe("bbb");
  });
});

describe("coverUrl", () => {
  it("serves a stored hash from the local art route", () => {
    expect(coverUrl("abc123", "vid1")).toBe("/api/art/abc123");
  });

  it("falls back to the YouTube thumbnail when there is no hash", () => {
    expect(coverUrl(null, "vid1")).toBe("https://i.ytimg.com/vi/vid1/hqdefault.jpg");
  });

  it("returns null with neither", () => {
    expect(coverUrl(null, null)).toBeNull();
    expect(coverUrl(undefined)).toBeNull();
  });
});

describe("isAllowedCoverHost", () => {
  it("accepts Cover Art Archive and YouTube thumbnail hosts over https", () => {
    expect(isAllowedCoverHost("https://coverartarchive.org/release/x/front-500")).toBe(true);
    expect(isAllowedCoverHost("https://ia800000.us.archive.org/x.jpg")).toBe(false);
    expect(isAllowedCoverHost("https://i.ytimg.com/vi/abc/maxresdefault.jpg")).toBe(true);
  });

  it("rejects any other host", () => {
    expect(isAllowedCoverHost("https://evil.example.com/x.jpg")).toBe(false);
    expect(isAllowedCoverHost("https://coverartarchive.org.evil.com/x.jpg")).toBe(false);
    // SSRF into the machine's own network is the reason this allowlist exists.
    expect(isAllowedCoverHost("http://127.0.0.1:5432/")).toBe(false);
    expect(isAllowedCoverHost("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects plain http even on an allowed host", () => {
    expect(isAllowedCoverHost("http://coverartarchive.org/release/x/front-500")).toBe(false);
  });

  it("rejects credential-embedding and malformed URLs", () => {
    expect(isAllowedCoverHost("https://user:pass@coverartarchive.org/x.jpg")).toBe(false);
    expect(isAllowedCoverHost("not a url")).toBe(false);
    expect(isAllowedCoverHost("")).toBe(false);
  });
});
