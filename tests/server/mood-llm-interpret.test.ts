import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  process.env.OLLAMA_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "test-model";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const MOODS = ["happy", "chill", "sad", "energetic", "focus", "romantic", "nostalgic"];

describe("interpretMood", () => {
  it("parses a mood blend + hints from Ollama and keeps only known moods", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: JSON.stringify({
          moods: { chill: 0.7, nostalgic: 0.4, bogus: 0.9 },
          genreHints: ["lo-fi", "Acoustic"],
          energy: "low",
        }),
      }),
    } as never);

    const { interpretMood } = await import("@/server/services/mood-llm");
    const r = await interpretMood("rainy sunday", MOODS);
    expect(r.weights).toEqual({ chill: 0.7, nostalgic: 0.4 }); // bogus dropped
    expect(r.genreHints).toEqual(["lo-fi", "acoustic"]); // normalized
    expect(r.energy).toBe("low");
  });

  it("clamps out-of-range weights", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ moods: { happy: 1.8, sad: -0.3 } }) }),
    } as never);
    const { interpretMood } = await import("@/server/services/mood-llm");
    const r = await interpretMood("x", MOODS);
    expect(r.weights.happy).toBe(1);
    expect(r.weights.sad).toBe(0);
  });

  it("falls back to keyword matching when Ollama is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { interpretMood } = await import("@/server/services/mood-llm");
    const r = await interpretMood("gym workout session", MOODS);
    expect(r.weights.energetic).toBeGreaterThan(0);
  });

  it("returns empty weights for unrecognizable text when Ollama is down", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("down"));
    const { interpretMood } = await import("@/server/services/mood-llm");
    const r = await interpretMood("qwertly zxcvb", MOODS);
    expect(Object.keys(r.weights)).toHaveLength(0);
  });
});

describe("seedTrackMoods", () => {
  it("returns clamped per-mood scores restricted to known moods", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: JSON.stringify({ moods: { chill: 0.8, energetic: 0.1, nope: 0.5 } }),
      }),
    } as never);
    const { seedTrackMoods } = await import("@/server/services/mood-llm");
    const r = await seedTrackMoods(
      { title: "After Dark", artist: "Mr.Kitty", genres: ["dark wave"] },
      MOODS,
    );
    expect(r).toEqual({ chill: 0.8, energetic: 0.1 });
  });

  it("returns {} when Ollama is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("down"));
    const { seedTrackMoods } = await import("@/server/services/mood-llm");
    const r = await seedTrackMoods({ title: "x", artist: "y", genres: [] }, MOODS);
    expect(r).toEqual({});
  });
});
