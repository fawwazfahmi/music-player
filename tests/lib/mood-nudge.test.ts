import { describe, expect, it } from "vitest";
import { shouldShowNudge } from "@/lib/mood-nudge";

const base = {
  inSession: true,
  belongs: true,
  reacted: false,
  progress: 0.7,
  songsSinceNudge: 3,
};

describe("shouldShowNudge", () => {
  it("shows once she's heard enough, in a session, unrated, after a gap", () => {
    expect(shouldShowNudge(base)).toBe(true);
  });
  it("never outside a mood session", () => {
    expect(shouldShowNudge({ ...base, inSession: false })).toBe(false);
  });
  it("never for a track not in the session", () => {
    expect(shouldShowNudge({ ...base, belongs: false })).toBe(false);
  });
  it("never for an already-rated track", () => {
    expect(shouldShowNudge({ ...base, reacted: true })).toBe(false);
  });
  it("waits until she's heard most of the song", () => {
    expect(shouldShowNudge({ ...base, progress: 0.3 })).toBe(false);
  });
  it("respects the gap between nudges", () => {
    expect(shouldShowNudge({ ...base, songsSinceNudge: 1 })).toBe(false);
  });
});
