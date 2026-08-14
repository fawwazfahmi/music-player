import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, PATCH_NOTES, unseenReleases } from "@/lib/patch-notes";

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
});
