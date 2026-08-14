import { describe, expect, it } from "vitest";
import { playbackSourceFor } from "@/lib/playback-source";

describe("playbackSourceFor", () => {
  it("records a cached YouTube download as YT_CACHED, not LOCAL_FILE", () => {
    // The original bug: every play was written as LOCAL_FILE, so the enum had
    // three values and only one was ever used.
    expect(playbackSourceFor("YT_CACHED")).toBe("YT_CACHED");
  });

  it("records a streaming YouTube track as YT_STREAM", () => {
    expect(playbackSourceFor("YT_STREAMING")).toBe("YT_STREAM");
  });

  it("treats scanned and uploaded files as local", () => {
    expect(playbackSourceFor("LOCAL_SCAN")).toBe("LOCAL_FILE");
    expect(playbackSourceFor("UPLOAD")).toBe("LOCAL_FILE");
  });

  it("falls back to LOCAL_FILE for an unrecognised source", () => {
    expect(playbackSourceFor("SOMETHING_NEW" as never)).toBe("LOCAL_FILE");
  });
});
