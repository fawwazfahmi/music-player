import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("library-scanner", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mu-scan-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    const { db } = await import("@/server/db");
    await db.track.deleteMany({});
    await db.album.deleteMany({});
    await db.artist.deleteMany({});
  });

  it("ingests a fake file into Artist→Album→Track", async () => {
    const file = path.join(tmp, "Test.m4a");
    await fs.writeFile(file, Buffer.alloc(8));
    const { scanOnce } = await import("@/server/services/library-scanner");
    const report = await scanOnce(tmp);
    expect(report.added).toBe(1);
    const { db } = await import("@/server/db");
    const tracks = await db.track.findMany({ include: { primaryArtist: true, album: true } });
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.title).toBe("Test");
    expect(tracks[0]?.primaryArtist.name).toBe("Unknown Artist");
  });

  it("dedupes identical files by sha256", async () => {
    const a = path.join(tmp, "A.m4a");
    const b = path.join(tmp, "B.m4a");
    await fs.writeFile(a, Buffer.from("identical-content"));
    await fs.writeFile(b, Buffer.from("identical-content"));
    const { scanOnce } = await import("@/server/services/library-scanner");
    const report = await scanOnce(tmp);
    expect(report.added).toBe(1);
    expect(report.skippedDuplicates).toBe(1);
  });
});
