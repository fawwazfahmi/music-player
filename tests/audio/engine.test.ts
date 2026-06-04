// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "@/audio/engine";

describe("audio engine", () => {
  let engine: ReturnType<typeof createEngine>;
  beforeEach(() => {
    engine = createEngine();
  });

  it("loadTrack sets src", () => {
    engine.loadTrack("track-123");
    expect(engine.getSrc()).toBe("/api/audio/track-123");
  });

  it("setVolume clamps to [0,1]", () => {
    engine.setVolume(-1);
    expect(engine.getVolume()).toBe(0);
    engine.setVolume(2);
    expect(engine.getVolume()).toBe(1);
  });

  it("seek sets currentTime", () => {
    engine.loadTrack("track-123");
    engine.seek(42);
    expect(engine.getCurrentTime()).toBe(42);
  });
});
