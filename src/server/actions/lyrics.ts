"use server";

import { db } from "@/server/db";
import { fetchLyrics, parseSyncedLyrics, type LyricLine } from "@/server/services/lrclib";

export interface GetLyricsResult {
  trackId: string;
  synced: LyricLine[];
  plain: string | null;
  instrumental: boolean;
  source: "cache" | "lrclib" | "none";
}

export async function getLyrics(trackId: string): Promise<GetLyricsResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: {
      primaryArtist: { select: { name: true } },
      album: { select: { title: true } },
    },
  });
  if (!track) return { trackId, synced: [], plain: null, instrumental: false, source: "none" };

  // Cache hit
  if (track.lyricsFetched && (track.lyricsSynced || track.lyricsPlain)) {
    return {
      trackId,
      synced: track.lyricsSynced ? parseSyncedLyrics(track.lyricsSynced) : [],
      plain: track.lyricsPlain ?? null,
      instrumental: false,
      source: "cache",
    };
  }

  try {
    const result = await fetchLyrics(
      track.primaryArtist.name,
      track.title,
      track.album?.title,
      track.duration,
    );
    if (!result) {
      // Mark as fetched (no lyrics) so we don't retry every time
      await db.track.update({
        where: { id: trackId },
        data: { lyricsFetched: new Date() },
      });
      return { trackId, synced: [], plain: null, instrumental: false, source: "none" };
    }

    await db.track.update({
      where: { id: trackId },
      data: {
        lyricsSynced: result.syncedLyrics,
        lyricsPlain: result.plainLyrics,
        lyricsFetched: new Date(),
      },
    });

    return {
      trackId,
      synced: result.syncedLyrics ? parseSyncedLyrics(result.syncedLyrics) : [],
      plain: result.plainLyrics,
      instrumental: result.instrumental,
      source: "lrclib",
    };
  } catch {
    return { trackId, synced: [], plain: null, instrumental: false, source: "none" };
  }
}
