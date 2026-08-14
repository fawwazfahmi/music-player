import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediaArtworkFor } from "@/audio/media-session";
import type { QueueTrack } from "@/stores/player-store";

function track(over: Partial<QueueTrack> = {}): QueueTrack {
  return {
    id: "t1",
    title: "Oblivion",
    artist: "Grimes",
    album: "Visions",
    duration: 252,
    coverArtHash: null,
    ytVideoId: null,
    ...over,
  };
}

describe("mediaArtworkFor", () => {
  it("uses stored art when we have it", () => {
    const hash = "a".repeat(64);
    expect(mediaArtworkFor(track({ coverArtHash: hash }))).toEqual([
      { src: `/api/art/${hash}`, sizes: "500x500", type: "image/jpeg" },
    ]);
  });

  it("falls back to the YouTube thumbnail instead of sending nothing", () => {
    // The regression this exists for: YT-sourced tracks have no stored hash, so
    // the lock screen got `artwork: []` and showed a blank grey square — while
    // the app's own UI rendered the thumbnail happily via coverUrl().
    const out = mediaArtworkFor(track({ ytVideoId: "vid123" }));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((a) => a.src.includes("vid123"))).toBe(true);
  });

  it("offers only genuinely distinct renditions", () => {
    const out = mediaArtworkFor(track({ ytVideoId: "vid123" }));
    const srcs = out.map((a) => a.src);
    const sizes = out.map((a) => a.sizes);
    // Declaring one URL under three sizes would be a lie that costs a download.
    expect(new Set(srcs).size).toBe(srcs.length);
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("prefers stored art over the thumbnail when both exist", () => {
    const hash = "b".repeat(64);
    const out = mediaArtworkFor(track({ coverArtHash: hash, ytVideoId: "vid123" }));
    expect(out).toHaveLength(1);
    expect(out[0]?.src).toBe(`/api/art/${hash}`);
  });

  it("returns an empty list when there is genuinely no image", () => {
    expect(mediaArtworkFor(track())).toEqual([]);
  });
});

describe("updateMediaPositionState", () => {
  const setPositionState = vi.fn();

  beforeEach(() => {
    setPositionState.mockReset();
    vi.stubGlobal("navigator", { mediaSession: { setPositionState } });
  });

  it("clamps position to duration", async () => {
    // setPositionState throws a TypeError when position > duration, which
    // happens on every track change: the new duration lands before the audio
    // element has reset currentTime. Unclamped, this throws inside a
    // timeupdate handler several times a second.
    const { updateMediaPositionState } = await import("@/audio/media-session");
    updateMediaPositionState(300, 252);
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 252,
      position: 252,
      playbackRate: 1,
    });
  });

  it("floors a negative position at zero", async () => {
    const { updateMediaPositionState } = await import("@/audio/media-session");
    updateMediaPositionState(-4, 252);
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 252,
      position: 0,
      playbackRate: 1,
    });
  });

  it("skips entirely when duration isn't known yet", async () => {
    const { updateMediaPositionState } = await import("@/audio/media-session");
    updateMediaPositionState(10, 0);
    updateMediaPositionState(10, Number.NaN);
    expect(setPositionState).not.toHaveBeenCalled();
  });

  it("never reports a non-positive playback rate", async () => {
    const { updateMediaPositionState } = await import("@/audio/media-session");
    updateMediaPositionState(10, 100, 0);
    expect(setPositionState).toHaveBeenCalledWith(
      expect.objectContaining({ playbackRate: 1 }),
    );
  });

  it("swallows a throwing platform implementation", async () => {
    setPositionState.mockImplementation(() => {
      throw new TypeError("bad state");
    });
    const { updateMediaPositionState } = await import("@/audio/media-session");
    expect(() => updateMediaPositionState(10, 100)).not.toThrow();
  });
});
