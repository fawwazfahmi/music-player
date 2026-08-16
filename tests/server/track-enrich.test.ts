import { describe, expect, it, vi } from "vitest";
import { enrichTrackExtras } from "@/server/services/track-enrich";

describe("enrichTrackExtras", () => {
  it("runs genres → audio → mood, passing force to the seeder", async () => {
    const calls: string[] = [];
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
      deps: { tagGenres, analyzeFile, storeFeatures, seedMoods, getFilePath: async () => "/f.m4a" },
    });
    expect(calls).toEqual(["genres", "analyze", "store", "seed:true"]);
  });

  it("still seeds moods when genre tagging throws (best-effort, independent)", async () => {
    const seedMoods = vi.fn(async () => {});
    await enrichTrackExtras("t1", {
      deps: {
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
