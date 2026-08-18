import { describe, expect, it } from "vitest";
import { containsCJK, romanizeLyrics } from "@/server/services/romanize";

describe("containsCJK", () => {
  it("detects Hangul, Kana, and Han; ignores Latin", () => {
    expect(containsCJK("사랑")).toBe(true);
    expect(containsCJK("こんにちは")).toBe(true);
    expect(containsCJK("世界")).toBe(true);
    expect(containsCJK("Hello world")).toBe(false);
    expect(containsCJK("Naega jeil jal naga")).toBe(false);
  });
});

describe("romanizeLyrics", () => {
  it("romanizes Hangul while preserving embedded Latin", () => {
    expect(romanizeLyrics("전쟁 같은 사랑 Armageddon")).toBe("jeonjaeng gateun sarang Armageddon");
  });

  it("preserves LRC timestamps and only romanizes the text", () => {
    expect(romanizeLyrics("[00:07.47] 내가 제일 잘 나가")).toBe("[00:07.47] naega jeil jal naga");
  });

  it("leaves already-Latin lyrics untouched (no-op)", () => {
    const en = "[00:01.00] Hey boy Imma getcha\n[00:03.00] Ah-oh!";
    expect(romanizeLyrics(en)).toBe(en);
  });

  it("romanizes Japanese kana", () => {
    expect(romanizeLyrics("こんにちは")).toBe("konnichiha");
  });

  it("keeps blank lines and structure across a multi-line block", () => {
    const out = romanizeLyrics("[00:01.00] 사랑\n\n[00:02.00] Ah");
    expect(out).toBe("[00:01.00] sarang\n\n[00:02.00] Ah");
  });
});
