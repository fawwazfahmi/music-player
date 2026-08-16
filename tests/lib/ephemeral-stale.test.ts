import { describe, expect, it } from "vitest";
import { isEphemeralStale } from "@/lib/ephemeral-stale";

const now = new Date("2026-08-16T00:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86400_000);

describe("isEphemeralStale", () => {
  it("stale when un-kept, old, and not played in 7d", () => {
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: days(8), now })).toBe(true);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: null, now })).toBe(true);
  });
  it("not stale if in library, recently created, or recently played", () => {
    expect(isEphemeralStale({ inLibrary: true, createdAt: days(10), lastPlayedAt: days(8), now })).toBe(false);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(2), lastPlayedAt: null, now })).toBe(false);
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(10), lastPlayedAt: days(1), now })).toBe(false);
  });
  it("honours a custom window", () => {
    expect(isEphemeralStale({ inLibrary: false, createdAt: days(3), lastPlayedAt: null, now, days: 2 })).toBe(true);
  });
});
