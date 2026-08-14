import { describe, expect, it } from "vitest";
import { isVideoPresenting, shouldMountVideoStage } from "@/lib/video-stage-policy";

const desktop = {
  performanceMode: false,
  isMobile: false,
  mobileArtMode: false,
  documentVisible: true,
  currentHasVideo: true,
};
const mobile = { ...desktop, isMobile: true };

describe("shouldMountVideoStage", () => {
  it("keeps the iframe alive on mobile regardless of the sheet", () => {
    // The regression this file exists for: existence used to depend on the
    // sheet being open, so every reopen rebuilt the player from scratch —
    // seconds of black, and sometimes it never started until playback was
    // toggled. Note there is no sheet input here at all, by design.
    expect(shouldMountVideoStage(mobile)).toBe(true);
  });

  it("is always on for desktop when performance mode is off", () => {
    expect(shouldMountVideoStage(desktop)).toBe(true);
    expect(shouldMountVideoStage({ ...desktop, mobileArtMode: true })).toBe(true);
    expect(shouldMountVideoStage({ ...desktop, currentHasVideo: false })).toBe(true);
  });

  it("performance mode wins everywhere", () => {
    expect(shouldMountVideoStage({ ...desktop, performanceMode: true })).toBe(false);
    expect(shouldMountVideoStage({ ...mobile, performanceMode: true })).toBe(false);
  });

  it("drops the iframe on mobile when it could not be shown anyway", () => {
    expect(shouldMountVideoStage({ ...mobile, mobileArtMode: true })).toBe(false);
    expect(shouldMountVideoStage({ ...mobile, documentVisible: false })).toBe(false);
    expect(shouldMountVideoStage({ ...mobile, currentHasVideo: false })).toBe(false);
  });
});

describe("isVideoPresenting", () => {
  it("is always true on desktop, where a slot is permanently on screen", () => {
    expect(isVideoPresenting({ isMobile: false, sheetOpen: false })).toBe(true);
    expect(isVideoPresenting({ isMobile: false, sheetOpen: true })).toBe(true);
  });

  it("follows the sheet on mobile", () => {
    expect(isVideoPresenting({ isMobile: true, sheetOpen: true })).toBe(true);
    expect(isVideoPresenting({ isMobile: true, sheetOpen: false })).toBe(false);
  });
});
