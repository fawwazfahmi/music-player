import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, PATCH_NOTES, unseenReleases, waveformBars } from "@/lib/patch-notes";

describe("patch notes", () => {
  it("keeps releases newest-first, so CURRENT_VERSION is the newest", () => {
    const versions = PATCH_NOTES.map((r) => r.version);
    const sorted = [...versions].sort().reverse();
    expect(versions).toEqual(sorted);
    expect(CURRENT_VERSION).toBe(versions[0]);
  });

  it("shows everything to a browser that has never seen them", () => {
    // Cleared storage or a different browser: as far as we can tell they have
    // read none of it, and Settings is the fallback if that's wrong.
    expect(unseenReleases(null)).toEqual(PATCH_NOTES);
  });

  it("shows nothing once the newest version has been seen", () => {
    expect(unseenReleases(CURRENT_VERSION)).toEqual([]);
  });

  it("shows only what came after the seen version", () => {
    const older = "2000.01.01";
    expect(unseenReleases(older)).toEqual(PATCH_NOTES);

    // A version above everything shipped hides them all, so a downgrade or a
    // stray value can't spam the dialog on every load.
    expect(unseenReleases("9999.12.31")).toEqual([]);
  });

  it("has no empty releases", () => {
    for (const r of PATCH_NOTES) {
      expect(r.changes.length).toBeGreaterThan(0);
      expect(r.title.trim()).not.toBe("");
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("gives each release a stable waveform", () => {
    // Same release, same wave — a strip that reshuffled on every open would
    // read as noise instead of as a property of the release.
    expect(waveformBars("2026.08.14")).toEqual(waveformBars("2026.08.14"));
    expect(waveformBars("2026.08.14")).not.toEqual(waveformBars("2026.09.01"));
  });

  it("keeps bars inside a readable band", () => {
    // 0 looks like a gap, 1 looks like a solid block; neither reads as a wave.
    for (const v of waveformBars("2026.08.14")) {
      expect(v).toBeGreaterThanOrEqual(0.25);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(waveformBars("x", 12)).toHaveLength(12);
  });
});
