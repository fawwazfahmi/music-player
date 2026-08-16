import { describe, expect, it } from "vitest";
import { displayAlbum } from "@/lib/album-name";

describe("displayAlbum", () => {
  it("relabels the catch-all 'YouTube' album as 'Singles'", () => {
    expect(displayAlbum("YouTube")).toBe("Singles");
  });
  it("leaves real album names alone", () => {
    expect(displayAlbum("Rust In Peace")).toBe("Rust In Peace");
  });
  it("handles empty/nullish", () => {
    expect(displayAlbum("")).toBe("");
    expect(displayAlbum(null)).toBe("");
    expect(displayAlbum(undefined)).toBe("");
  });
});
