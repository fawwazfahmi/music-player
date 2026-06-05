import { describe, expect, it } from "vitest";
import { parseYtTitle, cleanTitleTags } from "@/server/services/yt-title-parser";

describe("parseYtTitle", () => {
  it("splits 'Artist - Title' format", () => {
    expect(parseYtTitle("Radiohead - Karma Police", "Radiohead")).toEqual({
      artist: "Radiohead",
      title: "Karma Police",
    });
  });

  it("strips '(Official Video)' from title", () => {
    expect(parseYtTitle("Sabrina Carpenter - Manchild (Official Video)", "SabrinaCarpenterVEVO")).toEqual({
      artist: "Sabrina Carpenter",
      title: "Manchild",
    });
  });

  it("strips '@' prefix from artist", () => {
    expect(parseYtTitle("@laufey - From The Start (Lyrics)", "Dan Music")).toEqual({
      artist: "laufey",
      title: "From The Start",
    });
  });

  it("handles em-dash and en-dash separators", () => {
    expect(parseYtTitle("Tate McRae – Siren Sounds", "TateMcRae")).toEqual({
      artist: "Tate McRae",
      title: "Siren Sounds",
    });
    expect(parseYtTitle("Artist — Title", "X")).toEqual({
      artist: "Artist",
      title: "Title",
    });
  });

  it("handles middle-dot separator (auto-generated YT)", () => {
    expect(parseYtTitle("Laufey · From The Start", "Laufey - Topic")).toEqual({
      artist: "Laufey",
      title: "From The Start",
    });
  });

  it("falls back to uploader when no separator", () => {
    expect(parseYtTitle("Karma Police, RadioHead (Lyrics)", "WhiteDog91202")).toEqual({
      artist: "WhiteDog91202",
      title: "Karma Police, RadioHead",
    });
  });

  it("strips [bracket] tags", () => {
    expect(parseYtTitle("Artist - Song [Official Music Video]", "X")).toEqual({
      artist: "Artist",
      title: "Song",
    });
  });

  it("removes duplicate spaces after tag strip", () => {
    expect(cleanTitleTags("Song  (Official Video)  ")).toBe("Song");
  });

  it("uses 'Unknown' if uploader is empty and no separator", () => {
    expect(parseYtTitle("Just A Title", "")).toEqual({
      artist: "Unknown",
      title: "Just A Title",
    });
  });

  it("ignores leading or trailing separator (no empty side)", () => {
    expect(parseYtTitle("- Title Only", "Ch")).toEqual({
      artist: "Ch",
      title: "- Title Only",
    });
  });
});
