import { describe, expect, it, afterAll } from "vitest";
import { db } from "@/server/db";
import { createPendingDownload } from "@/server/services/yt-download";

const VIDEO = "ztestEPH01";
let createdTrackId: string | null = null;

afterAll(async () => {
  if (createdTrackId) await db.metadataJob.deleteMany({ where: { trackId: createdTrackId } });
  await db.ytCacheEntry.deleteMany({ where: { ytVideoId: VIDEO } });
  await db.track.deleteMany({ where: { ytVideoId: VIDEO } });
  await db.album.deleteMany({ where: { artist: { name: "ztest-eph-uploader" } } });
  await db.artist.deleteMany({ where: { name: "ztest-eph-uploader" } });
});

describe("createPendingDownload ephemeral", () => {
  it("creates the track with inLibrary:false when ephemeral", async () => {
    const { trackId } = await createPendingDownload(
      { videoId: VIDEO, title: "ztest-eph song", uploader: "ztest-eph-uploader", duration: 100, thumbnail: "" },
      { ephemeral: true },
    );
    createdTrackId = trackId;
    const t = await db.track.findUnique({ where: { id: trackId }, select: { inLibrary: true } });
    expect(t?.inLibrary).toBe(false);
  });
});
