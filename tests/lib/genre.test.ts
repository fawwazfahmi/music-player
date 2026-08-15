import { describe, expect, it } from "vitest";
import { normalizeGenre, displayGenre } from "@/lib/genre";

describe("genre helpers", () => {
  it("normalizeGenre trims, collapses whitespace, lowercases", () => {
    expect(normalizeGenre("  Indie   Rock ")).toBe("indie rock");
    expect(normalizeGenre("POP")).toBe("pop");
  });

  it("normalizeGenre returns empty string for blank input", () => {
    expect(normalizeGenre("   ")).toBe("");
  });

  it("displayGenre title-cases each word", () => {
    expect(displayGenre("indie rock")).toBe("Indie Rock");
    // Capitalizes after any non-word separator too, which is the desired
    // styling for genres like these.
    expect(displayGenre("r&b")).toBe("R&B");
    expect(displayGenre("k-pop")).toBe("K-Pop");
  });
});
