"use server";

import { db } from "@/server/db";
import { searchLibrary as serviceSearch } from "@/server/services/search";
import { searchYt as ytServiceSearch, type YtSearchResult } from "@/server/services/yt-service";
import { enqueueDownload } from "@/server/services/yt-download-queue";

export async function searchLibrary(query: string) {
  return serviceSearch(query);
}

export async function searchYt(query: string): Promise<YtSearchResult[]> {
  return ytServiceSearch(query, 5);
}

export async function selectYtResult(
  result: YtSearchResult,
): Promise<{ trackId: string }> {
  const existing = await db.track.findUnique({
    where: { ytVideoId: result.videoId },
    select: { id: true },
  });
  if (existing) return { trackId: existing.id };

  const artist = await db.artist.upsert({
    where: { name: result.uploader },
    create: { name: result.uploader, discoveredAt: new Date() },
    update: {},
  });
  const album = await db.album.upsert({
    where: { artistId_title: { artistId: artist.id, title: "YouTube" } },
    create: { title: "YouTube", artistId: artist.id },
    update: {},
  });
  const track = await db.track.create({
    data: {
      title: result.title,
      duration: result.duration,
      primaryArtistId: artist.id,
      albumId: album.id,
      ytVideoId: result.videoId,
      source: "YT_STREAMING",
      playable: true,
      discoveredAt: new Date(),
    },
    select: { id: true },
  });
  await db.ytCacheEntry.create({
    data: { ytVideoId: result.videoId, trackId: track.id, status: "PENDING" },
  });
  enqueueDownload(result.videoId);
  return { trackId: track.id };
}
