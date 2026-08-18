import { describe, expect, it } from "vitest";
import { vttToLrc, pickSubtitleLang } from "@/server/services/yt-subtitles";

describe("vttToLrc", () => {
  const VTT = `WEBVTT
Kind: captions
Language: ko

00:00:11.329 --> 00:00:15.848
Hey boy 난 널 내 거로 만들 거야

00:00:15.848 --> 00:00:19.925
Hey boy 날 만난 걸

00:00:19.925 --> 00:00:22.580
Ah-oh!
`;

  it("converts cue start times to [mm:ss.xx] LRC lines", () => {
    const { syncedLrc } = vttToLrc(VTT);
    const lines = syncedLrc.split("\n");
    expect(lines[0]).toBe("[00:11.32] Hey boy 난 널 내 거로 만들 거야");
    expect(lines[1]).toBe("[00:15.84] Hey boy 날 만난 걸");
    expect(lines[2]).toBe("[00:19.92] Ah-oh!");
  });

  it("also returns plain text with timestamps stripped", () => {
    const { plain } = vttToLrc(VTT);
    expect(plain).toBe("Hey boy 난 널 내 거로 만들 거야\nHey boy 날 만난 걸\nAh-oh!");
  });

  it("strips inline tags and collapses duplicate consecutive lines", () => {
    const dirty = `WEBVTT

00:00:01.000 --> 00:00:02.000
<c>Line A</c>

00:00:02.000 --> 00:00:03.000
Line A

00:00:03.000 --> 00:00:04.000
Line B
`;
    const { syncedLrc } = vttToLrc(dirty);
    const texts = syncedLrc.split("\n");
    // Duplicate "Line A" collapsed to one entry.
    expect(texts).toEqual(["[00:01.00] Line A", "[00:03.00] Line B"]);
  });

  it("returns empty strings for a header-only VTT", () => {
    expect(vttToLrc("WEBVTT\n\n")).toEqual({ syncedLrc: "", plain: "" });
  });
});

describe("pickSubtitleLang", () => {
  // Default (latinOnly): the app shows romaji/English only, never raw CJK.
  it("defaults to English and refuses a raw Hangul track", () => {
    expect(pickSubtitleLang(["en", "ko", "ja"])).toBe("en");
  });

  it("prefers a romanized (-Latn) track over an English translation", () => {
    expect(pickSubtitleLang(["en", "ko", "ko-Latn"])).toBe("ko-Latn");
  });

  it("returns null when only non-Latin scripts are available (default mode)", () => {
    expect(pickSubtitleLang(["ko", "ja", "zh"])).toBeNull();
  });

  // Native mode (latinOnly: false) — for the future picker, which romanizes.
  it("prefers the detected original language in native mode", () => {
    expect(pickSubtitleLang(["en", "ko", "ja"], { originalLang: "ko", latinOnly: false })).toBe("ko");
  });

  it("prefers CJK originals in native mode with no hint", () => {
    expect(pickSubtitleLang(["en", "es", "ko", "ja"], { latinOnly: false })).toBe("ko");
  });

  it("ignores live_chat pseudo-tracks", () => {
    expect(pickSubtitleLang(["live_chat"])).toBeNull();
    expect(pickSubtitleLang(["live_chat", "en"])).toBe("en");
  });

  it("returns null when nothing usable is available", () => {
    expect(pickSubtitleLang([])).toBeNull();
  });
});
