import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("tagTrackGenres", () => {
  let trackId = "";
  let artistId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "TaggerTest" },
      create: { name: "TaggerTest", mbid: "artist-mbid-tagger" },
      update: { mbid: "artist-mbid-tagger" },
    });
    artistId = artist.id;
    const t = await db.track.create({
      data: {
        title: "Tagger Song",
        duration: 100,
        filePath: `/tmp/tagger-${Date.now()}.m4a`,
        sha256: `tagger-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        mbid: `rec-mbid-${Date.now()}`,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.findUnique({
      where: { name: "TaggerTest" },
      select: { id: true },
    });
    if (artist) {
      const tracks = await db.track.findMany({
        where: { primaryArtistId: artist.id },
        select: { id: true },
      });
      const ids = tracks.map((t) => t.id);
      await db.trackGenre.deleteMany({ where: { trackId: { in: ids } } });
      await db.artistGenre.deleteMany({ where: { artistId: artist.id } });
      await db.track.deleteMany({ where: { id: { in: ids } } });
      await db.artist.delete({ where: { id: artist.id } });
    }
    await db.genre.deleteMany({
      where: { name: { in: ["ztag-pop", "ztag-dream pop", "ztag-bedroom pop"] } },
    });
  });

  it("uses recording genres from MusicBrainz when available", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const applied = await tagTrackGenres(trackId, {
      fetchMbGenres: vi.fn(async (entity) => (entity === "recording" ? ["ztag-pop", "ztag-dream pop"] : [])),
      classifyGenre: vi.fn(async () => ["should-not-be-used"]),
    });
    expect(applied).toEqual(["ztag-pop", "ztag-dream pop"]);
    const { db } = await import("@/server/db");
    const rows = await db.trackGenre.findMany({
      where: { trackId },
      select: { genre: { select: { name: true } } },
    });
    expect(rows.map((r) => r.genre.name).sort()).toEqual(["ztag-dream pop", "ztag-pop"]);
  });

  it("falls back to Ollama when MusicBrainz has none", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const classify = vi.fn(async () => ["ztag-bedroom pop"]);
    const applied = await tagTrackGenres(trackId, {
      fetchMbGenres: vi.fn(async () => []),
      classifyGenre: classify,
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(applied).toEqual(["ztag-bedroom pop"]);
  });

  it("writes ArtistGenre when genres come from the artist MBID", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    await tagTrackGenres(trackId, {
      // recording empty, artist has genres → those are artist-level
      fetchMbGenres: vi.fn(async (entity) => (entity === "artist" ? ["ztag-pop"] : [])),
      classifyGenre: vi.fn(async () => []),
    });
    const { db } = await import("@/server/db");
    const ag = await db.artistGenre.findMany({ where: { artistId } });
    expect(ag.length).toBe(1);
  });

  it("is idempotent — a second run adds nothing", async () => {
    const { tagTrackGenres } = await import("@/server/services/genre-tagger");
    const deps = {
      fetchMbGenres: vi.fn(async (entity: "recording" | "artist") =>
        entity === "recording" ? ["ztag-pop"] : [],
      ),
      classifyGenre: vi.fn(async () => []),
    };
    await tagTrackGenres(trackId, deps);
    const second = await tagTrackGenres(trackId, deps);
    expect(second).toEqual([]); // already tagged → no-op
    const { db } = await import("@/server/db");
    expect(await db.trackGenre.count({ where: { trackId } })).toBe(1);
  });
});
