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

const CANDS = [
  { id: "a", title: "A", artist: "x" },
  { id: "b", title: "B", artist: "y" },
  { id: "c", title: "C", artist: "z" },
];

describe("rerankByMood", () => {
  it("returns the LLM's order when valid", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ order: ["c", "a", "b"] }) }),
    } as never);
    const { rerankByMood } = await import("@/server/services/mood-llm");
    expect(await rerankByMood("Chill", CANDS)).toEqual(["c", "a", "b"]);
  });

  it("appends ids the LLM dropped, in original order", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ order: ["c"] }) }),
    } as never);
    const { rerankByMood } = await import("@/server/services/mood-llm");
    expect(await rerankByMood("Chill", CANDS)).toEqual(["c", "a", "b"]);
  });

  it("ignores unknown ids and de-dupes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: JSON.stringify({ order: ["b", "zzz", "b", "a", "c"] }) }),
    } as never);
    const { rerankByMood } = await import("@/server/services/mood-llm");
    expect(await rerankByMood("Chill", CANDS)).toEqual(["b", "a", "c"]);
  });

  it("returns null when Ollama is unavailable (caller keeps formula order)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("down"));
    const { rerankByMood } = await import("@/server/services/mood-llm");
    expect(await rerankByMood("Chill", CANDS)).toBeNull();
  });
});
