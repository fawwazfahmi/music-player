"use server";

import { db } from "@/server/db";
import { fetchLyrics, parseSyncedLyrics, type LyricLine } from "@/server/services/lrclib";
import { transcribeFile } from "@/server/services/whisper";

export type LyricsSource = "LRCLIB_SYNCED" | "LRCLIB_PLAIN" | "WHISPER" | "MANUAL";

export interface GetLyricsResult {
  trackId: string;
  synced: LyricLine[];
  plain: string | null;
  instrumental: boolean;
  /** Where the displayed lyrics came from. "cache" means we returned what was
      previously stored; the actual provenance is in `lyricsSource`. */
  source: "cache" | "lrclib" | "none";
  /** Stored provenance — present when we have any lyrics for this track. */
  lyricsSource: LyricsSource | null;
}

export async function getLyrics(trackId: string): Promise<GetLyricsResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: {
      primaryArtist: { select: { name: true } },
      album: { select: { title: true } },
    },
  });
  if (!track) {
    return {
      trackId,
      synced: [],
      plain: null,
      instrumental: false,
      source: "none",
      lyricsSource: null,
    };
  }

  // Cache hit
  if (track.lyricsFetched && (track.lyricsSynced || track.lyricsPlain)) {
    return {
      trackId,
      synced: track.lyricsSynced ? parseSyncedLyrics(track.lyricsSynced) : [],
      plain: track.lyricsPlain ?? null,
      instrumental: false,
      source: "cache",
      lyricsSource: track.lyricsSource as LyricsSource | null,
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
      return {
        trackId,
        synced: [],
        plain: null,
        instrumental: false,
        source: "none",
        lyricsSource: null,
      };
    }

    const lyricsSource: LyricsSource | null = result.syncedLyrics
      ? "LRCLIB_SYNCED"
      : result.plainLyrics
        ? "LRCLIB_PLAIN"
        : null;

    await db.track.update({
      where: { id: trackId },
      data: {
        lyricsSynced: result.syncedLyrics,
        lyricsPlain: result.plainLyrics,
        lyricsSource,
        lyricsFetched: new Date(),
      },
    });

    return {
      trackId,
      synced: result.syncedLyrics ? parseSyncedLyrics(result.syncedLyrics) : [],
      plain: result.plainLyrics,
      instrumental: result.instrumental,
      source: "lrclib",
      lyricsSource,
    };
  } catch {
    return {
      trackId,
      synced: [],
      plain: null,
      instrumental: false,
      source: "none",
      lyricsSource: null,
    };
  }
}

export interface TranscribeResult {
  trackId: string;
  synced: LyricLine[];
  plain: string;
  lyricsSource: "WHISPER";
}

/**
 * Transcribe a track using whisper.cpp. Stores result with WHISPER provenance,
 * overwriting whatever was there before. Returns the new synced lyrics so the
 * caller can re-render immediately.
 */
export async function transcribeTrack(trackId: string): Promise<TranscribeResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: { filePath: true },
  });
  if (!track?.filePath) {
    throw new Error("Track has no local audio file to transcribe");
  }

  const { syncedLrc, plainText } = await transcribeFile(track.filePath);

  await db.track.update({
    where: { id: trackId },
    data: {
      lyricsSynced: syncedLrc,
      lyricsPlain: plainText,
      lyricsSource: "WHISPER",
      lyricsFetched: new Date(),
    },
  });

  return {
    trackId,
    synced: parseSyncedLyrics(syncedLrc),
    plain: plainText,
    lyricsSource: "WHISPER",
  };
}
