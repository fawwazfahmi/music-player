import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { searchLibrary } from "@/server/services/search";

// Both tracks share a unique fuzzy-searchable token; only the library one should
// surface in library search.
const TOKEN = "ztestsrchtoken";
const trackIds: string[] = [];
const artistNames = ["ztest-srch-lib-artist", "ztest-srch-eph-artist"];

beforeAll(async () => {
  const libArtist = await db.artist.upsert({
    where: { name: artistNames[0]! },
    create: { name: artistNames[0]! },
    update: {},
  });
  const ephArtist = await db.artist.upsert({
    where: { name: artistNames[1]! },
    create: { name: artistNames[1]! },
    update: {},
  });
  const lib = await db.track.create({
    data: { title: `${TOKEN} library`, duration: 1, primaryArtistId: libArtist.id, playable: true, inLibrary: true },
  });
  const eph = await db.track.create({
    data: { title: `${TOKEN} ephemeral`, duration: 1, primaryArtistId: ephArtist.id, playable: true, inLibrary: false },
  });
  trackIds.push(lib.id, eph.id);
});

afterAll(async () => {
  await db.track.deleteMany({ where: { id: { in: trackIds } } });
  await db.artist.deleteMany({ where: { name: { in: artistNames } } });
});

describe("searchLibrary excludes ephemeral tracks", () => {
  it("returns the library track but not the ephemeral one", async () => {
    const res = await searchLibrary(`${TOKEN} library`);
    const titles = res.tracks.map((t) => t.title);
    expect(titles.some((t) => t.includes("library"))).toBe(true);
    expect(titles.some((t) => t.includes("ephemeral"))).toBe(false);
  });

  it("does not surface an ephemeral-only artist", async () => {
    const res = await searchLibrary("ztest-srch-eph-artist");
    expect(res.artists.map((a) => a.name)).not.toContain("ztest-srch-eph-artist");
  });
});
