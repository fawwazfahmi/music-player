import { describe, expect, it, vi } from "vitest";
import { resolveCleanMeta } from "@/server/services/title-cleaner";
import type { YtMeta } from "@/server/services/yt-service";

const meta = (m: Partial<YtMeta>): YtMeta => ({
  track: null,
  artists: [],
  album: null,
  description: "",
  uploader: "",
  ...m,
});

describe("resolveCleanMeta", () => {
  it("uses YouTube Art Track metadata when present (real multi-artist + album)", async () => {
    const r = await resolveCleanMeta(
      { videoId: "v1", title: "It's Been a Long, Long Time", artist: "Kitty Kallen - Topic", album: "YouTube" },
      {
        fetchYtMeta: async () =>
          meta({
            track: "It's Been a Long, Long Time",
            artists: ["Kitty Kallen", "The Harry James Orchestra"],
            album: "The Kitty Kallen Collection 1939-62",
          }),
      },
    );
    expect(r).toEqual({
      title: "It's Been a Long, Long Time",
      artists: ["Kitty Kallen", "The Harry James Orchestra"],
      album: "The Kitty Kallen Collection 1939-62",
      source: "ytmeta",
    });
  });

  it("falls back to the description credit block", async () => {
    const r = await resolveCleanMeta(
      { videoId: "v2", title: "raw", artist: "Some Channel", album: "YouTube" },
      {
        fetchYtMeta: async () =>
          meta({
            description:
              "Provided to YouTube by X\n\nBlue Monday · New Order\n\nPower, Corruption & Lies\n\n℗ 1983",
          }),
      },
    );
    expect(r.source).toBe("description");
    expect(r.title).toBe("Blue Monday");
    expect(r.artists).toEqual(["New Order"]);
    expect(r.album).toBe("Power, Corruption & Lies");
  });

  it("deterministic: fixes fullwidth title, keeps markers, no metadata", async () => {
    const r = await resolveCleanMeta(
      {
        videoId: "v3",
        title: "Ｈｏｍｅ （Ｓｌｏｗｅｄ ＆ Ｒｅｖｅｒｂｅｄ） [Official Video]",
        artist: "HoloHarmony",
        album: "YouTube",
      },
      { fetchYtMeta: async () => null },
    );
    expect(r.source).toBe("deterministic");
    expect(r.title).toBe("Home (Slowed & Reverbed)");
    expect(r.artists).toEqual(["HoloHarmony"]);
  });

  it("deterministic: strips '- Topic' from the artist", async () => {
    const r = await resolveCleanMeta(
      { videoId: null, title: "Some Song", artist: "Kitty Kallen - Topic", album: "" },
      { fetchYtMeta: vi.fn() },
    );
    expect(r.artists).toEqual(["Kitty Kallen"]);
    expect(r.source).toBe("deterministic");
  });

  it("caps artists at three and de-dupes", async () => {
    const r = await resolveCleanMeta(
      { videoId: "v4", title: "x", artist: "y", album: "" },
      {
        fetchYtMeta: async () =>
          meta({ track: "Mashup", artists: ["A", "A", "B", "C", "D"] }),
      },
    );
    expect(r.artists).toEqual(["A", "B", "C"]);
  });
});
