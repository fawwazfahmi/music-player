import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/services/musicbrainz", () => ({
  searchRecording: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.MUSIC_LIBRARY_PATH = "/srv/music";
  process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
  process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
  process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
  process.env.COOKIE_SECRET = "x".repeat(48);
});

function candidate(id: string) {
  return { id, thumbUrl: "t", fullUrl: "f", label: id };
}

describe("dedupeCandidates", () => {
  it("removes duplicate ids, keeping the first occurrence", async () => {
    const { dedupeCandidates } = await import("@/server/services/cover-candidates");
    const out = dedupeCandidates([
      candidate("a"),
      candidate("b"),
      candidate("a"),
      candidate("c"),
    ]);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("caps the list at 8 by default", async () => {
    const { dedupeCandidates, MAX_COVER_CANDIDATES } = await import(
      "@/server/services/cover-candidates"
    );
    expect(MAX_COVER_CANDIDATES).toBe(8);
    const many = Array.from({ length: 30 }, (_, i) => candidate(`c${i}`));
    expect(dedupeCandidates(many)).toHaveLength(8);
  });
});

describe("buildCoverCandidates", () => {
  it("puts the current cover first, then CAA releases, then YouTube", async () => {
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([
      {
        mbid: "rec1",
        score: 100,
        title: "Song",
        artistName: "Artist",
        releases: [
          { mbid: "rel1", title: "The Album" },
          { mbid: "rel2", title: "Deluxe Edition" },
        ],
      },
    ] as never);

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates(
      { artistName: "Artist", title: "Song", ytVideoId: "vid1", currentHash: "f".repeat(64) },
      async () => true,
    );

    expect(out[0]?.isCurrent).toBe(true);
    expect(out.map((c) => c.id)).toEqual([
      `current:${"f".repeat(64)}`,
      "caa:rel1",
      "caa:rel2",
      "yt:maxres:vid1",
      "yt:hq:vid1",
    ]);
    expect(out[1]?.thumbUrl).toContain("front-250");
    expect(out[1]?.fullUrl).toContain("front-500");
  });

  it("dedupes the same release appearing under several recordings", async () => {
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([
      { mbid: "r1", score: 100, title: "S", artistName: "A", releases: [{ mbid: "rel1", title: "X" }] },
      { mbid: "r2", score: 90, title: "S", artistName: "A", releases: [{ mbid: "rel1", title: "X" }] },
    ] as never);

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates({ artistName: "A", title: "S" }, async () => true);
    expect(out.filter((c) => c.id === "caa:rel1")).toHaveLength(1);
  });

  it("still offers YouTube thumbnails when MusicBrainz throws", async () => {
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockRejectedValueOnce(new Error("MusicBrainz 503"));

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates(
      { artistName: "A", title: "S", ytVideoId: "vid9" },
      async () => true,
    );
    expect(out.map((c) => c.id)).toEqual(["yt:maxres:vid9", "yt:hq:vid9"]);
  });

  it("returns an empty list when there is nothing to offer", async () => {
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([] as never);

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates({ artistName: "A", title: "S" }, async () => true);
    expect(out).toEqual([]);
  });

  it("drops candidates whose image is not actually there", async () => {
    // Cover Art Archive 404s for a large share of releases, and YouTube's
    // maxresdefault is missing on many older uploads. Probed live against
    // real data: 2 of 3 CAA thumbnails 404'd.
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([
      {
        mbid: "r1",
        score: 100,
        title: "S",
        artistName: "A",
        releases: [
          { mbid: "dead", title: "Missing Art" },
          { mbid: "live", title: "Real Art" },
        ],
      },
    ] as never);

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates(
      { artistName: "A", title: "S", ytVideoId: "v" },
      async (url) => !url.includes("dead") && !url.includes("maxresdefault"),
    );
    expect(out.map((c) => c.id)).toEqual(["caa:live", "yt:hq:v"]);
  });

  it("never lets duplicate releases squeeze out the YouTube fallbacks", async () => {
    // Real regression: one track returned five separate "Visions" releases,
    // which filled all 8 slots and pushed the YouTube thumbnails out entirely.
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([
      {
        mbid: "r1",
        score: 100,
        title: "S",
        artistName: "A",
        releases: Array.from({ length: 12 }, (_, i) => ({
          mbid: `rel${i}`,
          title: `Album ${i}`,
        })),
      },
    ] as never);

    const { buildCoverCandidates, MAX_COVER_CANDIDATES } = await import(
      "@/server/services/cover-candidates"
    );
    const out = await buildCoverCandidates(
      { artistName: "A", title: "S", ytVideoId: "v", currentHash: "a".repeat(64) },
      async () => true,
    );
    expect(out).toHaveLength(MAX_COVER_CANDIDATES);
    expect(out.some((c) => c.id === "yt:maxres:v")).toBe(true);
    expect(out.some((c) => c.id === "yt:hq:v")).toBe(true);
    expect(out[0]?.isCurrent).toBe(true);
  });

  it("collapses releases that are really the same album under different mbids", async () => {
    const mb = await import("@/server/services/musicbrainz");
    vi.mocked(mb.searchRecording).mockResolvedValueOnce([
      {
        mbid: "r1",
        score: 100,
        title: "Oblivion",
        artistName: "Grimes",
        releases: [
          { mbid: "v1", title: "Visions" },
          { mbid: "v2", title: "Visions" },
          { mbid: "v3", title: "visions" },
          { mbid: "other", title: "Art Angels" },
        ],
      },
    ] as never);

    const { buildCoverCandidates } = await import("@/server/services/cover-candidates");
    const out = await buildCoverCandidates({ artistName: "Grimes", title: "Oblivion" }, async () => true);
    expect(out.map((c) => c.label)).toEqual(["Visions", "Art Angels"]);
  });

  it("labels YouTube thumbnails as 16:9 so the cropping is explained", async () => {
    const { youtubeCandidates } = await import("@/server/services/cover-candidates");
    for (const c of youtubeCandidates("abc")) {
      expect(c.note).toMatch(/16:9/);
    }
  });
});
