import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  process.env.OLLAMA_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "test-model";
});
afterEach(() => vi.unstubAllGlobals());

function mockOllama(json: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ response: JSON.stringify(json) }),
  } as never);
}

describe("cleanTrackMeta", () => {
  it("fixes spaced-out titles and keeps the version marker + real artist", async () => {
    mockOllama({ title: "Home (Slowed & Reverbed)", artists: ["Mr.Kitty"], changed: true });
    const { cleanTrackMeta } = await import("@/server/services/title-cleaner");
    const r = await cleanTrackMeta({
      title: "H o m e - Mr.  K i t t y ( S l o w e d & R e v e r b e d )",
      artist: "HoloHarmony",
      album: "YouTube",
    });
    expect(r).toEqual({ title: "Home (Slowed & Reverbed)", artists: ["Mr.Kitty"] });
  });

  it("returns null when nothing needs changing", async () => {
    mockOllama({ title: "Blinding Lights", artists: ["The Weeknd"], changed: false });
    const { cleanTrackMeta } = await import("@/server/services/title-cleaner");
    expect(
      await cleanTrackMeta({ title: "Blinding Lights", artist: "The Weeknd", album: "After Hours" }),
    ).toBeNull();
  });

  it("supports multiple artists for a mashup, de-duped and capped", async () => {
    mockOllama({
      title: "After Dark x Sweater Weather",
      artists: ["Mr.Kitty", "Mr.Kitty", "The Neighbourhood", "Extra", "More"],
      changed: true,
    });
    const { cleanTrackMeta } = await import("@/server/services/title-cleaner");
    const r = await cleanTrackMeta({ title: "After Dark x Sweater Weather", artist: "Mikeeysmind", album: "YouTube" });
    expect(r?.artists).toEqual(["Mr.Kitty", "The Neighbourhood", "Extra"]);
  });

  it("returns null on unusable output (empty title or no artists)", async () => {
    mockOllama({ title: "", artists: [], changed: true });
    const { cleanTrackMeta } = await import("@/server/services/title-cleaner");
    expect(await cleanTrackMeta({ title: "x", artist: "y", album: "z" })).toBeNull();
  });

  it("returns null when Ollama is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("down"));
    const { cleanTrackMeta } = await import("@/server/services/title-cleaner");
    expect(await cleanTrackMeta({ title: "x", artist: "y", album: "z" })).toBeNull();
  });
});
