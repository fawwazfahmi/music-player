import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { cleanupEphemeralTracks } from "@/server/services/ephemeral-sweeper";

let artistId: string;
let staleId: string;
let freshId: string;
let libId: string;
const now = new Date("2026-08-16T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000);

beforeAll(async () => {
  const a = await db.artist.upsert({
    where: { name: "ztest-sweep-artist" },
    create: { name: "ztest-sweep-artist" },
    update: {},
  });
  artistId = a.id;
  const stale = await db.track.create({
    data: {
      title: "ztest-sweep-stale",
      duration: 1,
      primaryArtistId: artistId,
      inLibrary: false,
      filePath: "/tmp/ztest-sweep-stale.m4a",
      createdAt: daysAgo(10),
    },
  });
  staleId = stale.id;
  const fresh = await db.track.create({
    data: { title: "ztest-sweep-fresh", duration: 1, primaryArtistId: artistId, inLibrary: false, createdAt: now },
  });
  freshId = fresh.id;
  const lib = await db.track.create({
    data: { title: "ztest-sweep-lib", duration: 1, primaryArtistId: artistId, inLibrary: true, createdAt: daysAgo(10) },
  });
  libId = lib.id;
});

afterAll(async () => {
  await db.track.deleteMany({ where: { id: { in: [staleId, freshId, libId] } } });
  await db.artist.deleteMany({ where: { name: "ztest-sweep-artist" } });
});

describe("cleanupEphemeralTracks", () => {
  it("deletes only the stale un-kept pick and unlinks its file", async () => {
    const unlink = vi.fn(async (_p: string) => {});
    await cleanupEphemeralTracks({ unlink, now: () => now });

    expect(unlink).toHaveBeenCalledWith("/tmp/ztest-sweep-stale.m4a");
    expect(await db.track.findUnique({ where: { id: staleId } })).toBeNull();
    expect(await db.track.findUnique({ where: { id: freshId } })).not.toBeNull();
    expect(await db.track.findUnique({ where: { id: libId } })).not.toBeNull();
  });
});
