import { describe, expect, it } from "vitest";
import { blendAffinity } from "@/server/services/mood-engine";

describe("blendAffinity", () => {
  it("returns the seed when there is no learned signal", () => {
    expect(blendAffinity(0.8, 0.1, 0)).toBeCloseTo(0.8);
  });

  it("shifts toward the learned score as signal accumulates", () => {
    const few = blendAffinity(0.2, 1, 5); // K=5 → half weight
    expect(few).toBeCloseTo(0.6);
    const many = blendAffinity(0.2, 1, 95); // heavily learned
    expect(many).toBeGreaterThan(0.9);
  });

  it("is bounded to [0,1]", () => {
    expect(blendAffinity(2, 2, 10)).toBeLessThanOrEqual(1);
    expect(blendAffinity(-1, -1, 10)).toBeGreaterThanOrEqual(0);
  });
});
