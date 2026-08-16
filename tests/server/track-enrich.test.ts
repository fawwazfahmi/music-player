import { describe, expect, it, vi } from "vitest";
import { enrichTrackExtras } from "@/server/services/track-enrich";

describe("enrichTrackExtras", () => {
  it("runs clean → genres → audio → mood, passing force to the seeder", async () => {
    const calls: string[] = [];
    const cleanMeta = vi.fn(async () => calls.push("clean"));
    const tagGenres = vi.fn(async () => calls.push("genres"));
    const analyzeFile = vi.fn(async () => {
      calls.push("analyze");
      return { mood_happy: 0.5 };
    });
    const storeFeatures = vi.fn(async () => {
      calls.push("store");
    });
    const seedMoods = vi.fn(async (_id: string, opts: { force?: boolean }) => {
      calls.push(`seed:${opts.force}`);
    });
    await enrichTrackExtras("t1", {
      force: true,
      deps: { cleanMeta, tagGenres, analyzeFile, storeFeatures, seedMoods, getFilePath: async () => "/f.m4a" },
    });
    // Cleaning runs FIRST so genres/mood key off the corrected title & artist.
    expect(calls).toEqual(["clean", "genres", "analyze", "store", "seed:true"]);
  });

  it("still tags genres when title cleaning throws (best-effort, independent)", async () => {
    const tagGenres = vi.fn(async () => {});
    await enrichTrackExtras("t1", {
      deps: {
        cleanMeta: vi.fn(async () => {
          throw new Error("yt-dlp down");
        }),
        tagGenres,
        analyzeFile: vi.fn(async () => null),
        storeFeatures: vi.fn(async () => {}),
        seedMoods: vi.fn(async () => {}),
        getFilePath: async () => null,
      },
    });
    expect(tagGenres).toHaveBeenCalledOnce();
  });

  it("still seeds moods when genre tagging throws (best-effort, independent)", async () => {
    const seedMoods = vi.fn(async () => {});
    await enrichTrackExtras("t1", {
      deps: {
        cleanMeta: vi.fn(async () => {}),
        tagGenres: vi.fn(async () => {
          throw new Error("mb down");
        }),
        analyzeFile: vi.fn(async () => null),
        storeFeatures: vi.fn(async () => {}),
        seedMoods,
        getFilePath: async () => null,
      },
    });
    expect(seedMoods).toHaveBeenCalledOnce();
  });

  it("skips audio when there is no local file", async () => {
    const analyzeFile = vi.fn(async () => null);
    await enrichTrackExtras("t1", {
      deps: {
        cleanMeta: vi.fn(async () => {}),
        tagGenres: vi.fn(async () => {}),
        analyzeFile,
        storeFeatures: vi.fn(async () => {}),
        seedMoods: vi.fn(async () => {}),
        getFilePath: async () => null,
      },
    });
    expect(analyzeFile).not.toHaveBeenCalled();
  });
});
