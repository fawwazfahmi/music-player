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

describe("mood-llm.classifyGenre", () => {
  it("parses a JSON genre array from Ollama's response envelope", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ genres: ["Pop", "Synth-pop"] }) }),
    } as never);

    const { classifyGenre } = await import("@/server/services/mood-llm");
    const genres = await classifyGenre({ title: "Blinding Lights", artist: "The Weeknd" });
    expect(genres).toEqual(["pop", "synth-pop"]);
  });

  it("sends the configured model to /api/generate", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ genres: [] }) }),
    } as never);

    const { classifyGenre } = await import("@/server/services/mood-llm");
    await classifyGenre({ title: "x", artist: "y" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:11434/api/generate");
    expect(JSON.parse((init as RequestInit).body as string).model).toBe("test-model");
  });

  it("returns [] when Ollama is unreachable (fetch throws)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { classifyGenre } = await import("@/server/services/mood-llm");
    expect(await classifyGenre({ title: "x", artist: "y" })).toEqual([]);
  });

  it("returns [] when the model emits non-JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: "sorry, I cannot help with that" }),
    } as never);
    const { classifyGenre } = await import("@/server/services/mood-llm");
    expect(await classifyGenre({ title: "x", artist: "y" })).toEqual([]);
  });

  it("caps at 3 genres and de-duplicates after normalizing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: JSON.stringify({ genres: ["Pop", "pop", "Rock", "Jazz", "Soul"] }),
      }),
    } as never);
    const { classifyGenre } = await import("@/server/services/mood-llm");
    const genres = await classifyGenre({ title: "x", artist: "y" });
    expect(genres).toEqual(["pop", "rock", "jazz"]);
  });
});
