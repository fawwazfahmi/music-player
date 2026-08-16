import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { toggleFavorite } from "@/server/actions/favorites";

let artistId: string;
const IDS: string[] = [];

beforeAll(async () => {
  const a = await db.artist.upsert({
    where: { name: "ztest-favadopt-artist" },
    create: { name: "ztest-favadopt-artist" },
    update: {},
  });
  artistId = a.id;
});
afterAll(async () => {
  await db.favoriteTrack.deleteMany({ where: { trackId: { in: IDS } } });
  await db.track.deleteMany({ where: { id: { in: IDS } } });
  await db.artist.deleteMany({ where: { name: "ztest-favadopt-artist" } });
});

describe("favoriting an ephemeral track adopts it", () => {
  it("flips inLibrary to true when favoriting an ephemeral pick", async () => {
    const t = await db.track.create({
      data: { title: "ztest-favadopt", duration: 1, primaryArtistId: artistId, inLibrary: false },
    });
    IDS.push(t.id);
    await toggleFavorite("TRACK", t.id);
    const after = await db.track.findUnique({ where: { id: t.id }, select: { inLibrary: true } });
    expect(after?.inLibrary).toBe(true);
  });

  it("leaves an already-library track alone (still favorited, still in library)", async () => {
    const t = await db.track.create({
      data: { title: "ztest-favadopt-lib", duration: 1, primaryArtistId: artistId, inLibrary: true },
    });
    IDS.push(t.id);
    const fav = await toggleFavorite("TRACK", t.id);
    expect(fav).toBe(true);
    const after = await db.track.findUnique({ where: { id: t.id }, select: { inLibrary: true } });
    expect(after?.inLibrary).toBe(true);
  });
});
