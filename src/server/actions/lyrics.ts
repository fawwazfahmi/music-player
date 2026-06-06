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
  /** True when LRCLIB missed and we kicked off a background Whisper
      transcription. The lyrics panel polls getLyrics again every few seconds
      while this is set. */
  autoTranscribing: boolean;
}

// Module-level lock so concurrent getLyrics calls for the same track don't
// fire whisper twice. Cleared when the background job finishes (success or
// fail).
const inFlightTranscriptions = new Set<string>();

export async function getLyrics(trackId: string): Promise<GetLyricsResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: {
      primaryArtist: { select: { name: true } },
      album: { select: { title: true } },
    },
  });
  if (!track) {
    return empty(trackId);
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
      autoTranscribing: false,
    };
  }

  // A whisper job is already in flight for this track from a previous call.
  if (inFlightTranscriptions.has(trackId)) {
    return { ...empty(trackId), autoTranscribing: true };
  }

  // Try LRCLIB
  let result: Awaited<ReturnType<typeof fetchLyrics>> | null = null;
  try {
    result = await fetchLyrics(
      track.primaryArtist.name,
      track.title,
      track.album?.title,
      track.duration,
    );
  } catch {
    // network blip — fall through, may try whisper anyway
  }

  if (result) {
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
      autoTranscribing: false,
    };
  }

  // LRCLIB returned nothing. Off-canonical YT tracks (covers, demos, niche
  // uploads) almost never have an LRCLIB match — auto-fire Whisper instead
  // of making the user click "Transcribe with AI" every time. Only do this
  // for tracks we have a real m4a for.
  const isYtSourced = track.source === "YT_CACHED" || track.source === "YT_STREAMING";
  if (isYtSourced && track.filePath) {
    inFlightTranscriptions.add(trackId);
    const filePath = track.filePath;
    void (async () => {
      try {
        const { syncedLrc, plainText } = await transcribeFile(filePath);
        await db.track.update({
          where: { id: trackId },
          data: {
            lyricsSynced: syncedLrc,
            lyricsPlain: plainText,
            lyricsSource: "WHISPER",
            lyricsFetched: new Date(),
          },
        });
        console.log(`[mu] auto-transcribed ${trackId} via Whisper`);
      } catch (e) {
        console.error(`[mu] auto-transcribe failed for ${trackId}:`, e);
        // Mark as fetched so we don't try LRCLIB or whisper on every page view.
        await db.track
          .update({
            where: { id: trackId },
            data: { lyricsFetched: new Date() },
          })
          .catch(() => {});
      } finally {
        inFlightTranscriptions.delete(trackId);
      }
    })();
    return { ...empty(trackId), autoTranscribing: true };
  }

  // Not YT-sourced (LOCAL_SCAN) or no audio file — give up, mark fetched so
  // we don't keep hitting LRCLIB.
  await db.track.update({
    where: { id: trackId },
    data: { lyricsFetched: new Date() },
  });
  return empty(trackId);
}

function empty(trackId: string): GetLyricsResult {
  return {
    trackId,
    synced: [],
    plain: null,
    instrumental: false,
    source: "none",
    lyricsSource: null,
    autoTranscribing: false,
  };
}

export interface TranscribeResult {
  trackId: string;
  synced: LyricLine[];
  plain: string;
  lyricsSource: "WHISPER";
}

/**
 * Persist user-edited synced lyrics. The client reconstructs the full LRC
 * string from its in-memory line list and sends it whole — round-trip is
 * cheap and the server doesn't need to know which specific line changed.
 *
 * Also recomputes lyricsPlain so the plain-text fallback view stays in
 * sync (strip the timestamps, join non-empty lines).
 */
export async function updateSyncedLyrics(
  trackId: string,
  syncedLrc: string,
): Promise<void> {
  const plain = syncedLrc
    .split(/\r?\n/)
    .map((l) => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");

  await db.track.update({
    where: { id: trackId },
    data: {
      lyricsSynced: syncedLrc,
      lyricsPlain: plain,
      lyricsFetched: new Date(),
      // Don't downgrade WHISPER → MANUAL on every edit; users edit one or two
      // lines and the provenance is still mostly Whisper. The fact that
      // they tweaked it is captured by lyricsFetched moving forward.
    },
  });
}

/**
 * Manual re-transcription — overwrites whatever's stored. Bypasses the
 * auto-transcribe lock since the user explicitly asked for it.
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
