import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("applyCleanMeta", () => {
  let trackId = "";
  const artistNames = ["ApplyTest Uploader", "ApplyTest Real", "ApplyTest Feat"];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "ApplyTest Uploader" },
      create: { name: "ApplyTest Uploader" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
      create: { title: "YouTube", artistId: artist.id },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "raw messy title",
        duration: 100,
        ytVideoId: `applytest-${Date.now()}`,
        sha256: `applytest-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "YT_CACHED",
      },
      select: { id: true },
    });
    trackId = t.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    const artists = await db.artist.findMany({
      where: { name: { in: artistNames } },
      select: { id: true },
    });
    const ids = artists.map((a) => a.id);
    const tracks = await db.track.findMany({
      where: { primaryArtistId: { in: ids } },
      select: { id: true },
    });
    const tids = tracks.map((t) => t.id);
    await db.trackArtist.deleteMany({ where: { trackId: { in: tids } } });
    await db.track.deleteMany({ where: { id: { in: tids } } });
    await db.album.deleteMany({ where: { artistId: { in: ids } } });
    await db.artist.deleteMany({ where: { id: { in: ids } } });
  });

  it("updates title, re-links real primary + additional artists, and sets the real album", async () => {
    const { applyCleanMeta } = await import("@/server/services/title-cleaner");
    const res = await applyCleanMeta(trackId, {
      resolveCleanMeta: async () => ({
        title: "Clean Song",
        artists: ["ApplyTest Real", "ApplyTest Feat"],
        album: "Real Album",
        source: "ytmeta",
      }),
    });
    expect(res.changed).toBe(true);

    const { db } = await import("@/server/db");
    const t = await db.track.findUnique({
      where: { id: trackId },
      select: {
        title: true,
        primaryArtist: { select: { name: true } },
        additionalArtists: { select: { artist: { select: { name: true } } } },
        album: { select: { title: true } },
      },
    });
    expect(t?.title).toBe("Clean Song");
    expect(t?.primaryArtist.name).toBe("ApplyTest Real");
    expect(t?.additionalArtists.map((a) => a.artist.name)).toEqual(["ApplyTest Feat"]);
    expect(t?.album?.title).toBe("Real Album");
  });

  it("is a no-op when the resolved meta already matches", async () => {
    const { applyCleanMeta } = await import("@/server/services/title-cleaner");
    const res = await applyCleanMeta(trackId, {
      resolveCleanMeta: async () => ({
        title: "raw messy title",
        artists: ["ApplyTest Uploader"],
        album: "YouTube",
        source: "deterministic",
      }),
    });
    expect(res.changed).toBe(false);
  });
});
