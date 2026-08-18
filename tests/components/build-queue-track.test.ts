import { describe, expect, it } from "vitest";

import { buildQueueTrack } from "@/components/pages/_shared";

// Regression cover for the OBS now-playing overlay rendering a blank grey box.
//
// The overlay resolves art as: coverArtHash -> /api/art/<hash>, else ytVideoId
// -> i.ytimg.com thumbnail, else nothing (a #222 placeholder). In this library
// only 2 of 129 tracks have a coverArtHash, so ytVideoId is the ONLY art source
// for ~98% of tracks. Three pages built queue tracks without passing it, and
// every track queued from them lost its art.
describe("buildQueueTrack art plumbing", () => {
  const base = { id: "t1", title: "Smart", duration: 194 };

  it("keeps ytVideoId, the only art source for most of the library", () => {
    const q = buildQueueTrack({ ...base, artistName: "LE SSERAFIM", ytVideoId: "abc123" });
    expect(q.ytVideoId).toBe("abc123");
  });

  it("still yields art when the track has no cover hash at all", () => {
    const q = buildQueueTrack({ ...base, artistName: "x", coverArtHash: null, ytVideoId: "yt1" });
    expect(q.coverArtHash).toBeNull();
    expect(q.ytVideoId).toBe("yt1"); // overlay falls back to the YT thumbnail
  });

  it("prefers a per-track cover over the album's", () => {
    const q = buildQueueTrack({
      ...base, artistName: "x", ytVideoId: null,
      trackCoverArtHash: "track-hash",
      album: { title: "A", coverArtHash: "album-hash" },
    });
    expect(q.coverArtHash).toBe("track-hash");
  });

  it("falls back to album art when the track has none", () => {
    const q = buildQueueTrack({
      ...base, artistName: "x", ytVideoId: null,
      trackCoverArtHash: null,
      album: { title: "A", coverArtHash: "album-hash" },
    });
    expect(q.coverArtHash).toBe("album-hash");
  });

  it("reports no art rather than inventing any", () => {
    const q = buildQueueTrack({ ...base, artistName: "x", ytVideoId: null });
    expect(q.coverArtHash).toBeNull();
    expect(q.ytVideoId).toBeNull();
  });
});
