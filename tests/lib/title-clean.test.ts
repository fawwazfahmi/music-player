import { describe, expect, it } from "vitest";
import { normalizeWidth, tidyTitle, parseYtMusicDescription } from "@/lib/title-clean";

describe("normalizeWidth", () => {
  it("converts fullwidth characters to ASCII", () => {
    expect(normalizeWidth("Ｈｏｍｅ － Ｍｒ． Ｋｉｔｔｙ")).toBe("Home - Mr. Kitty");
  });
  it("collapses single-letter spacing", () => {
    expect(normalizeWidth("H o m e")).toBe("Home");
    expect(normalizeWidth("S l o w e d")).toBe("Slowed");
  });
  it("leaves normal text alone", () => {
    expect(normalizeWidth("Blinding Lights")).toBe("Blinding Lights");
  });
});

describe("tidyTitle", () => {
  it("keeps version markers but drops noise", () => {
    expect(tidyTitle("Home (Slowed & Reverbed) [Official Lyric Video]")).toBe(
      "Home (Slowed & Reverbed)",
    );
  });
  it("drops a trailing 'lyrics'", () => {
    expect(tidyTitle("Lithium (lyrics)")).toBe("Lithium");
  });
  it("normalizes width first", () => {
    expect(tidyTitle("Ｈｏｍｅ （Ｓｌｏｗｅｄ）")).toBe("Home (Slowed)");
  });
});

describe("parseYtMusicDescription", () => {
  it("parses the 'Provided to YouTube by' credit block", () => {
    const desc =
      "Provided to YouTube by The Orchard Enterprises\n\n" +
      "It's Been a Long, Long Time · Kitty Kallen · The Harry James Orchestra\n\n" +
      "The Kitty Kallen Collection 1939-62\n\n℗ 2015";
    expect(parseYtMusicDescription(desc)).toEqual({
      title: "It's Been a Long, Long Time",
      artists: ["Kitty Kallen", "The Harry James Orchestra"],
      album: "The Kitty Kallen Collection 1939-62",
    });
  });
  it("returns null when there is no credit block", () => {
    expect(parseYtMusicDescription("check out my remix!! subscribe")).toBeNull();
    expect(parseYtMusicDescription("")).toBeNull();
  });
});
