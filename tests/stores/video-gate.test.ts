import { describe, expect, it } from "vitest";
import { videoGateOpen } from "@/stores/player-store";

/**
 * The gate is a two-line function guarding a bug that has shipped twice: audio
 * waiting on a video stage that no longer exists, leaving playback silent with
 * nothing left to start it.
 */
describe("videoGateOpen", () => {
  it("is open only when the stage will actually be there", () => {
    expect(videoGateOpen({ performanceMode: false, videoGateEnabled: true })).toBe(true);
  });

  it("is closed in performance mode, which unmounts the stage", () => {
    expect(videoGateOpen({ performanceMode: true, videoGateEnabled: true })).toBe(false);
  });

  it("is closed on mobile, where the iframe is torn down on lock and on sheet close", () => {
    expect(videoGateOpen({ performanceMode: false, videoGateEnabled: false })).toBe(false);
  });

  it("stays closed when both apply", () => {
    expect(videoGateOpen({ performanceMode: true, videoGateEnabled: false })).toBe(false);
  });
});
