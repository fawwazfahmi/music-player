import { describe, expect, it } from "vitest";
import { parseYtTitle, cleanTitleTags, aggressivelyCleanTitle, stripTitleNoise } from "@/server/services/yt-title-parser";

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

  it("strips '(Bridge Demo)' and similar variant tags", () => {
    expect(parseYtTitle("Tate McRae - siren sounds (bridge demo)", "X")).toEqual({
      artist: "Tate McRae",
      title: "siren sounds",
    });
    expect(parseYtTitle("Artist - Song (Acoustic Version)", "X")).toEqual({
      artist: "Artist",
      title: "Song",
    });
    expect(parseYtTitle("Artist - Song (Piano Demo)", "X")).toEqual({
      artist: "Artist",
      title: "Song",
    });
  });

  it("aggressivelyCleanTitle strips any parenthetical + decoration symbols", () => {
    expect(aggressivelyCleanTitle("siren sounds ☆ (bridge demo)")).toBe("siren sounds");
    expect(aggressivelyCleanTitle("Song (Some Variant) [Extra]")).toBe("Song");
  });

  it("ignores leading or trailing separator (no empty side)", () => {
    expect(parseYtTitle("- Title Only", "Ch")).toEqual({
      artist: "Ch",
      title: "- Title Only",
    });
  });

  // K-pop / MV titles put the artist before a quoted song title, and the
  // uploader is a label ("JYP Entertainment") — so the quote is the only real
  // artist signal.
  it("parses ARTIST “Song” M/V (curly quotes), not the label uploader", () => {
    expect(parseYtTitle('TWICE “Strategy ” M/V', "JYP Entertainment")).toEqual({
      artist: "TWICE",
      title: "Strategy",
    });
  });

  it("parses ARTIST 'Song' with straight single quotes", () => {
    expect(parseYtTitle("aespa 'Armageddon' MV", "SMTOWN")).toEqual({
      artist: "aespa",
      title: "Armageddon",
    });
  });

  it("drops the redundant Korean name, keeping the romanized artist", () => {
    expect(parseYtTitle("aespa 에스파 'Armageddon' MV (Performance Ver.)", "SMTOWN")).toEqual({
      artist: "aespa",
      title: "Armageddon",
    });
    expect(parseYtTitle("IVE 아이브 'After LIKE' MV", "STARSHIP")).toEqual({
      artist: "IVE",
      title: "After LIKE",
    });
  });

  it("parses ARTIST (native) 'Song' — the label paren before the quote", () => {
    expect(parseYtTitle("LE SSERAFIM (르세라핌) 'Smart' OFFICIAL MV", "HYBE LABELS")).toEqual({
      artist: "LE SSERAFIM",
      title: "Smart",
    });
    expect(parseYtTitle("KISS OF LIFE (키스오브라이프) 'Sticky' Official Music Video", "KISS OF LIFE")).toEqual({
      artist: "KISS OF LIFE",
      title: "Sticky",
    });
  });

  it("does NOT mistake a quoted album/word mid-title for artist/song", () => {
    // The quote wraps "Insomnia" inside a parenthetical — no artist prefix, so
    // the quote rule must not fire; fall back to the uploader.
    expect(parseYtTitle('Memory (From "Insomnia" Album)', "Narvent")).toEqual({
      artist: "Narvent",
      title: 'Memory (From "Insomnia" Album)',
    });
  });

  it("still prefers a dash separator over the quote rule", () => {
    expect(parseYtTitle('NIDJI - Rahasia Hati', "NIDJI OFFICIAL")).toEqual({
      artist: "NIDJI",
      title: "Rahasia Hati",
    });
  });
});

describe("stripTitleNoise", () => {
  it("drops a trailing junk segment after a separator", () => {
    expect(stripTitleNoise("Wonderful Tonight - Electric Guitar Cover by Kfir Ochaion - Jamzone App")).toBe(
      "Wonderful Tonight",
    );
    expect(stripTitleNoise("Hotel California | Lyric Video | Lirik Indonesia | Indo Subtitle")).toBe(
      "Hotel California",
    );
    expect(stripTitleNoise("The End Of The World / HQ 1963")).toBe("The End Of The World");
    expect(stripTitleNoise("Tears in Heaven / Lyrics")).toBe("Tears in Heaven");
  });

  it("drops bare trailing MV / lyrics tokens", () => {
    expect(stripTitleNoise("Nirvana-Lithium Lyrics")).toBe("Nirvana-Lithium");
    expect(stripTitleNoise("Rahasia Hati Official Music Video")).toBe("Rahasia Hati");
  });

  it("takes the opening quoted song as the title", () => {
    expect(stripTitleNoise("'DRIP' M/V")).toBe("DRIP");
    expect(stripTitleNoise("“Strategy”")).toBe("Strategy");
    expect(stripTitleNoise("'LIKE THAT' EXCLUSIVE PERFORMANCE VIDEO")).toBe("LIKE THAT");
  });

  it("keeps version markers and clean titles untouched", () => {
    expect(stripTitleNoise("Home (Slowed & Reverbed)")).toBe("Home (Slowed & Reverbed)");
    expect(stripTitleNoise("Money for Nothing")).toBe("Money for Nothing");
    expect(stripTitleNoise("Somebody ft. Drew Love")).toBe("Somebody ft. Drew Love");
  });
});
