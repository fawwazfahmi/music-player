"use server";

import { db } from "@/server/db";
import { fetchLyrics, parseSyncedLyrics, type LyricLine } from "@/server/services/lrclib";
import { transcribeFile, isJunkTranscript } from "@/server/services/whisper";
import { fetchUploaderSubtitles } from "@/server/services/yt-subtitles";
import { anyConnectedCookiePath } from "@/server/services/yt-cookies";

export type LyricsSource = "LRCLIB_SYNCED" | "LRCLIB_PLAIN" | "YT_SUBTITLE" | "WHISPER" | "MANUAL";

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
  /** Per-song sync nudge in ms (positive = lyrics earlier). Applied to the
      highlight so mistimed LRCLIB lyrics can be lined up with our audio. */
  offsetMs: number;
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
      offsetMs: track.lyricsOffsetMs,
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
      offsetMs: track.lyricsOffsetMs,
    };
  }

  // LRCLIB returned nothing. Off-canonical YT tracks (covers, demos, niche
  // uploads) and foreign-language songs rarely have an LRCLIB match. Resolve in
  // the background (the panel polls) through: uploader subtitles (romaji /
  // English, synced) → Whisper (English model, junk output discarded).
  const isYtSourced = track.source === "YT_CACHED" || track.source === "YT_STREAMING";
  if (isYtSourced && (track.ytVideoId || track.filePath)) {
    inFlightTranscriptions.add(trackId);
    const videoId = track.ytVideoId;
    const filePath = track.filePath;
    void (async () => {
      try {
        // 1) Uploader-provided YouTube captions — the correct lyrics for
        //    Korean/Japanese songs, in Latin script, and timestamped (synced).
        if (videoId) {
          const cookiePath = await anyConnectedCookiePath().catch(() => null);
          const subs = await fetchUploaderSubtitles(videoId, { cookiePath });
          if (subs) {
            await db.track.update({
              where: { id: trackId },
              data: {
                lyricsSynced: subs.syncedLrc || null,
                lyricsPlain: subs.plain,
                lyricsSource: "YT_SUBTITLE",
                lyricsFetched: new Date(),
              },
            });
            console.log(`[mu] lyrics from uploader subtitles (${subs.lang}) for ${trackId}`);
            return;
          }
        }

        // 2) Whisper — but only keep it if it's real lyrics. The English-only
        //    model returns "(singing in foreign language)" for CJK; never store that.
        if (filePath) {
          const { syncedLrc, plainText } = await transcribeFile(filePath);
          if (!isJunkTranscript(plainText)) {
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
            return;
          }
          console.log(`[mu] discarded junk Whisper transcript for ${trackId}`);
        }

        // Nothing usable — mark fetched so we don't retry on every page view.
        await db.track.update({ where: { id: trackId }, data: { lyricsFetched: new Date() } });
      } catch (e) {
        console.error(`[mu] lyrics resolution failed for ${trackId}:`, e);
        await db.track
          .update({ where: { id: trackId }, data: { lyricsFetched: new Date() } })
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
    offsetMs: 0,
  };
}

/** The user-selectable lyrics sources in the panel picker. */
export type LyricsSourceChoice = "LRCLIB" | "YT_SUBTITLE" | "WHISPER";

function toResult(
  trackId: string,
  synced: string | null,
  plain: string | null,
  lyricsSource: LyricsSource,
  offsetMs = 0,
): GetLyricsResult {
  return {
    trackId,
    synced: synced ? parseSyncedLyrics(synced) : [],
    plain,
    instrumental: false,
    source: lyricsSource.startsWith("LRCLIB") ? "lrclib" : "cache",
    lyricsSource,
    autoTranscribing: false,
    offsetMs,
  };
}

/** Persist a per-song lyrics sync nudge (ms, positive = lyrics earlier).
    Clamped to ±10s — a sane manual-nudge range. */
export async function setLyricsOffset(trackId: string, offsetMs: number): Promise<void> {
  const clamped = Math.max(-10_000, Math.min(10_000, Math.round(offsetMs)));
  await db.track.update({ where: { id: trackId }, data: { lyricsOffsetMs: clamped } });
}

/**
 * Fetch lyrics from ONE specific source on the user's explicit request (the
 * panel's source picker), store them, and return them. Throws a short,
 * user-facing message when that source has nothing for this track.
 */
export async function resolveLyricsFrom(
  trackId: string,
  choice: LyricsSourceChoice,
): Promise<GetLyricsResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: { primaryArtist: { select: { name: true } }, album: { select: { title: true } } },
  });
  if (!track) return empty(trackId);

  if (choice === "LRCLIB") {
    const r = await fetchLyrics(track.primaryArtist.name, track.title, track.album?.title, track.duration).catch(
      () => null,
    );
    if (!r || !(r.syncedLyrics || r.plainLyrics)) throw new Error("No LRCLIB match for this song");
    const src: LyricsSource = r.syncedLyrics ? "LRCLIB_SYNCED" : "LRCLIB_PLAIN";
    await db.track.update({
      where: { id: trackId },
      data: { lyricsSynced: r.syncedLyrics, lyricsPlain: r.plainLyrics, lyricsSource: src, lyricsFetched: new Date() },
    });
    return toResult(trackId, r.syncedLyrics, r.plainLyrics, src, track.lyricsOffsetMs);
  }

  if (choice === "YT_SUBTITLE") {
    if (!track.ytVideoId) throw new Error("This track isn't from YouTube");
    const cookiePath = await anyConnectedCookiePath().catch(() => null);
    const s = await fetchUploaderSubtitles(track.ytVideoId, { cookiePath, latinOnly: true });
    if (!s) throw new Error("No uploader subtitles (romaji/English) on this video");
    await db.track.update({
      where: { id: trackId },
      data: { lyricsSynced: s.syncedLrc || null, lyricsPlain: s.plain, lyricsSource: "YT_SUBTITLE", lyricsFetched: new Date() },
    });
    return toResult(trackId, s.syncedLrc || null, s.plain, "YT_SUBTITLE", track.lyricsOffsetMs);
  }

  // WHISPER — explicit user choice, so store whatever it returns.
  if (!track.filePath) throw new Error("No local audio file to transcribe");
  const { syncedLrc, plainText } = await transcribeFile(track.filePath);
  await db.track.update({
    where: { id: trackId },
    data: { lyricsSynced: syncedLrc, lyricsPlain: plainText, lyricsSource: "WHISPER", lyricsFetched: new Date() },
  });
  return toResult(trackId, syncedLrc, plainText, "WHISPER", track.lyricsOffsetMs);
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
