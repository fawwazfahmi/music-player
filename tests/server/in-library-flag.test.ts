import { describe, expect, it, afterAll } from "vitest";
import { db } from "@/server/db";

const IDS: string[] = [];
afterAll(async () => {
  await db.track.deleteMany({ where: { id: { in: IDS } } });
  await db.artist.deleteMany({ where: { name: "ztest-inlib-artist" } });
});

describe("Track.inLibrary", () => {
  it("defaults to true for a normally-created track", async () => {
    const artist = await db.artist.upsert({
      where: { name: "ztest-inlib-artist" },
      create: { name: "ztest-inlib-artist" },
      update: {},
    });
    const t = await db.track.create({
      data: { title: "ztest-inlib", duration: 1, primaryArtistId: artist.id },
    });
    IDS.push(t.id);
    expect(t.inLibrary).toBe(true);
  });

  it("can be created ephemeral", async () => {
    const artist = await db.artist.findUniqueOrThrow({ where: { name: "ztest-inlib-artist" } });
    const t = await db.track.create({
      data: { title: "ztest-inlib-eph", duration: 1, primaryArtistId: artist.id, inLibrary: false },
    });
    IDS.push(t.id);
    expect(t.inLibrary).toBe(false);
  });
});
