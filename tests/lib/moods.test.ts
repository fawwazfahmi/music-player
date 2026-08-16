import { describe, expect, it } from "vitest";
import {
  BUILTIN_MOODS,
  BUILTIN_MOOD_NAMES,
  normalizeMoodName,
  clampWeight,
} from "@/lib/moods";

describe("mood vocabulary", () => {
  it("defines the seven built-in moods with unique names and emoji", () => {
    expect(BUILTIN_MOODS).toHaveLength(7);
    const names = BUILTIN_MOODS.map((m) => m.name);
    expect(new Set(names).size).toBe(7);
    for (const m of BUILTIN_MOODS) {
      expect(m.name).toBe(m.name.toLowerCase());
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.emoji.length).toBeGreaterThan(0);
    }
    expect(BUILTIN_MOOD_NAMES).toEqual(names);
  });

  it("normalizeMoodName trims and lowercases", () => {
    expect(normalizeMoodName("  Chill ")).toBe("chill");
    expect(normalizeMoodName("ENERGETIC")).toBe("energetic");
  });

  it("clampWeight bounds to [0,1]", () => {
    expect(clampWeight(-0.5)).toBe(0);
    expect(clampWeight(1.5)).toBe(1);
    expect(clampWeight(0.4)).toBe(0.4);
    expect(clampWeight(Number.NaN)).toBe(0);
  });
});
