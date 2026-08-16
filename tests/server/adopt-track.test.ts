import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { db } from "@/server/db";
import { adoptTrack } from "@/server/actions/library";

let artistId: string;
const IDS: string[] = [];

beforeAll(async () => {
  const a = await db.artist.upsert({
    where: { name: "ztest-adopt-artist" },
    create: { name: "ztest-adopt-artist" },
    update: {},
  });
  artistId = a.id;
});
afterAll(async () => {
  await db.track.deleteMany({ where: { id: { in: IDS } } });
  await db.artist.deleteMany({ where: { name: "ztest-adopt-artist" } });
});

describe("adoptTrack", () => {
  it("flips an ephemeral track into the library", async () => {
    const t = await db.track.create({
      data: { title: "ztest-adopt", duration: 1, primaryArtistId: artistId, inLibrary: false },
    });
    IDS.push(t.id);
    await adoptTrack(t.id);
    const after = await db.track.findUnique({ where: { id: t.id }, select: { inLibrary: true } });
    expect(after?.inLibrary).toBe(true);
  });

  it("is a no-op on an already-library track and a missing id (no throw)", async () => {
    const t = await db.track.create({
      data: { title: "ztest-adopt-lib", duration: 1, primaryArtistId: artistId, inLibrary: true },
    });
    IDS.push(t.id);
    await expect(adoptTrack(t.id)).resolves.toBeUndefined();
    await expect(adoptTrack("does-not-exist")).resolves.toBeUndefined();
  });
});
