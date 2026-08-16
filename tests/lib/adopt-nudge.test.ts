import { describe, expect, it } from "vitest";
import { shouldShowAdoptNudge } from "@/lib/adopt-nudge";

const base = { isEphemeral: true, adopted: false, dismissed: false, progress: 0.7, songsSinceNudge: 3 };

describe("shouldShowAdoptNudge", () => {
  it("shows for an un-kept ephemeral track past the thresholds", () => {
    expect(shouldShowAdoptNudge(base)).toBe(true);
  });
  it("never shows for a library track, or once adopted/dismissed", () => {
    expect(shouldShowAdoptNudge({ ...base, isEphemeral: false })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, adopted: true })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, dismissed: true })).toBe(false);
  });
  it("waits for progress and the gap", () => {
    expect(shouldShowAdoptNudge({ ...base, progress: 0.3 })).toBe(false);
    expect(shouldShowAdoptNudge({ ...base, songsSinceNudge: 1 })).toBe(false);
  });
});
