import { describe, expect, it } from "vitest";
import { bucketFor, RAMP } from "@/components/pages/ListeningHeatmap";

describe("bucketFor", () => {
  it("returns -1 for empty cells so they render as 'no data', not 'a little'", () => {
    expect(bucketFor(0, 1000)).toBe(-1);
    expect(bucketFor(-5, 1000)).toBe(-1);
  });

  it("guards against a zero max on an empty dataset", () => {
    expect(bucketFor(0, 0)).toBe(-1);
    expect(bucketFor(10, 0)).toBe(-1);
  });

  it("puts the busiest cell in the top step and never overflows the ramp", () => {
    expect(bucketFor(1000, 1000)).toBe(RAMP.length - 1);
    // Defensive: a cell should never exceed max, but must not index past the ramp.
    expect(bucketFor(5000, 1000)).toBe(RAMP.length - 1);
  });

  it("gives any non-zero listening at least the lowest visible step", () => {
    // The whole point of -1 being reserved for empty: one second of listening
    // must still be visible, not blend into an untouched hour.
    expect(bucketFor(1, 100000)).toBe(0);
  });

  it("stays monotonic as listening increases", () => {
    const max = 8000;
    const steps = [1, 100, 800, 2000, 4000, 8000].map((s) => bucketFor(s, max));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    }
  });

  it("uses a sqrt scale so low values aren't all flattened into one step", () => {
    // Linear bucketing of this skewed data would put 10% and 30% of max in the
    // same bottom step; sqrt separates them.
    const max = 10000;
    expect(bucketFor(0.1 * max, max)).toBeLessThan(bucketFor(0.3 * max, max));
  });
});
