import { describe, expect, it } from "vitest";
import { lufsToEnergy } from "@/server/services/audio-features";

describe("lufsToEnergy", () => {
  it("maps quiet → low energy and loud → high energy", () => {
    expect(lufsToEnergy(-30)).toBeCloseTo(0);
    expect(lufsToEnergy(-5)).toBeCloseTo(1);
    expect(lufsToEnergy(-17.5)).toBeCloseTo(0.5);
  });
  it("clamps out-of-range and handles NaN", () => {
    expect(lufsToEnergy(-40)).toBe(0);
    expect(lufsToEnergy(0)).toBe(1);
    expect(lufsToEnergy(Number.NaN)).toBe(0.5);
  });
});
