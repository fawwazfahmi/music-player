import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("playlists actions", () => {
  let trackIds: string[] = [];
  let createdPlaylistIds: string[] = [];

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "PlTest" },
      create: { name: "PlTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "PlAlbum" } },
      create: { title: "PlAlbum", artistId: artist.id },
      update: {},
    });
    trackIds = [];
    for (let i = 0; i < 3; i++) {
      const t = await db.track.create({
        data: {
          title: `PlTrack ${i}`,
          duration: 100,
          filePath: `/tmp/pltest-${Date.now()}-${i}.m4a`,
          sha256: `pltest-${Date.now()}-${Math.random()}-${i}`,
          primaryArtistId: artist.id,
          albumId: album.id,
          source: "LOCAL_SCAN",
        },
        select: { id: true },
      });
      trackIds.push(t.id);
    }
    createdPlaylistIds = [];
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.playlist.deleteMany({ where: { id: { in: createdPlaylistIds } } });
    await db.track.deleteMany({ where: { id: { in: trackIds } } });
    await db.album.deleteMany({ where: { title: "PlAlbum" } });
    await db.artist.deleteMany({ where: { name: "PlTest" } });
  });

  it("create + add + reorder + delete", async () => {
    const {
      createPlaylist,
      addToPlaylist,
      reorderPlaylist,
      getPlaylistWithTracks,
      deletePlaylist,
    } = await import("@/server/actions/playlists");

    const { id } = await createPlaylist("My Mix");
    createdPlaylistIds.push(id);

    for (const t of trackIds) await addToPlaylist(id, t);
    let pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.map((t) => t.id)).toEqual(trackIds);

    const reversed = [...trackIds].reverse();
    await reorderPlaylist(id, reversed);
    pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.map((t) => t.id)).toEqual(reversed);

    await deletePlaylist(id);
    pl = await getPlaylistWithTracks(id);
    expect(pl).toBeNull();
    createdPlaylistIds = [];
  });

  it("addToPlaylist is idempotent", async () => {
    const { createPlaylist, addToPlaylist, getPlaylistWithTracks } = await import(
      "@/server/actions/playlists"
    );
    const { id } = await createPlaylist("Idempotent");
    createdPlaylistIds.push(id);
    const t = trackIds[0]!;
    await addToPlaylist(id, t);
    await addToPlaylist(id, t);
    const pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.length).toBe(1);
  });

  it("removeFromPlaylist drops the track", async () => {
    const { createPlaylist, addToPlaylist, removeFromPlaylist, getPlaylistWithTracks } =
      await import("@/server/actions/playlists");
    const { id } = await createPlaylist("Remove Test");
    createdPlaylistIds.push(id);
    await addToPlaylist(id, trackIds[0]!);
    await addToPlaylist(id, trackIds[1]!);
    await removeFromPlaylist(id, trackIds[0]!);
    const pl = await getPlaylistWithTracks(id);
    expect(pl?.tracks.map((t) => t.id)).toEqual([trackIds[1]]);
  });
});
