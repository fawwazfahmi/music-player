import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  process.env.MUSICBRAINZ_USER_AGENT = "MusicUniverse-Test/1.0 ( test@example.com )";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("musicbrainz service", () => {
  it("searchRecording parses /ws/2/recording response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        recordings: [
          {
            id: "abc-123",
            score: 100,
            title: "From The Start",
            "artist-credit": [{ artist: { id: "artist-mb-1", name: "Laufey" } }],
            releases: [{ id: "release-mb-1", title: "Bewitched" }],
          },
          {
            id: "def-456",
            score: 72,
            title: "From The Start (Live)",
            "artist-credit": [{ artist: { id: "artist-mb-1", name: "Laufey" } }],
            releases: [{ id: "release-mb-2", title: "Live at Royal Albert Hall" }],
          },
        ],
      }),
    } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    const results = await searchRecording("Laufey", "From The Start");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      mbid: "abc-123",
      score: 100,
      title: "From The Start",
      artistName: "Laufey",
      artistMbid: "artist-mb-1",
      releaseMbid: "release-mb-1",
      releaseTitle: "Bewitched",
    });
  });

  it("getArtist returns name + optional bio", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "artist-mb-1",
        name: "Laufey",
        annotation: "Icelandic-Chinese jazz singer-songwriter",
      }),
    } as never);

    const { getArtist } = await import("@/server/services/musicbrainz");
    const a = await getArtist("artist-mb-1");
    expect(a.name).toBe("Laufey");
    expect(a.bio).toMatch(/Icelandic/);
  });

  it("sends User-Agent header per MB etiquette", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ recordings: [] }),
    } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    await searchRecording("x", "y");
    const call = vi.mocked(fetch).mock.calls[0]!;
    const headers = (call[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["User-Agent"]).toMatch(/MusicUniverse/);
  });

  it("retries on 503 (succeeds on 2nd attempt)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503 } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ recordings: [] }),
      } as never);

    const { searchRecording } = await import("@/server/services/musicbrainz");
    const results = await searchRecording("x", "y");
    expect(results).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
  }, 10_000);
});
