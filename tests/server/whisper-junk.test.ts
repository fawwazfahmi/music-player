import { describe, expect, it } from "vitest";
import { isJunkTranscript } from "@/server/services/whisper";

describe("isJunkTranscript", () => {
  it("flags the CJK failure output (foreign-language + music placeholders)", () => {
    const plain = [
      "(singing in foreign language)",
      "(upbeat music)",
      "(singing in foreign language)",
      "(upbeat music)",
      "- Oh my God.",
      "[BLANK_AUDIO]",
    ].join("\n");
    expect(isJunkTranscript(plain)).toBe(true);
  });

  it("flags empty / whitespace output", () => {
    expect(isJunkTranscript("")).toBe(true);
    expect(isJunkTranscript("   \n  ")).toBe(true);
  });

  it("flags a transcript that is only music/annotation cues", () => {
    expect(isJunkTranscript("[Music]\n♪♪♪\n(instrumental)")).toBe(true);
  });

  it("keeps a real English transcript", () => {
    const plain = ["Shoot", "I'mma get him", "Shoot", "We go way up"].join("\n");
    expect(isJunkTranscript(plain)).toBe(false);
  });

  it("keeps a transcript with a few cues but mostly real lines", () => {
    const plain = ["(music)", "Hello from the other side", "I must have called", "At least I can say"].join("\n");
    expect(isJunkTranscript(plain)).toBe(false);
  });
});
