"use server";

import { db } from "@/server/db";
import { getAllMoods } from "@/server/services/mood-store";
import { runMoodSession, type MoodSessionResult } from "@/server/services/mood-session";
import { applyMoodSignal, type MoodSignal } from "@/server/services/mood-learning";
import { suggestYtForMood } from "@/server/services/mood-yt";
import type { YtSearchResult } from "@/server/services/yt-service";
import { currentListenerOr } from "@/server/current-listener";

export interface MoodChip {
  id: string;
  name: string;
  label: string;
  emoji: string | null;
}

export async function getMoods(): Promise<MoodChip[]> {
  const moods = await getAllMoods();
  return moods.map((m) => ({ id: m.id, name: m.name, label: m.label, emoji: m.emoji }));
}

export interface StartMoodSessionInput {
  moodId?: string;
  freeText?: string;
  limit?: number;
}

export async function startMoodSession(input: StartMoodSessionInput): Promise<MoodSessionResult> {
  // Mood learning is per-listener; default to "ainul" when the cookie is absent
  // so a session always has an owner.
  const listener = await currentListenerOr("ainul");
  return runMoodSession({
    listener,
    moodId: input.moodId,
    freeText: input.freeText,
    limit: input.limit,
  });
}

/** Record a learning signal for a track within a mood session. Fire-and-forget
    from the client; failures are swallowed so they never disrupt playback. */
export async function recordMoodSignal(
  sessionId: string,
  trackId: string,
  signal: MoodSignal,
): Promise<void> {
  try {
    await applyMoodSignal({ sessionId, trackId, signal });
  } catch {
    /* learning is best-effort */
  }
}

/** Fresh YouTube picks for a mood session (Phase 4). Loaded lazily so mood
    generation stays instant; returns [] on any failure. */
export async function getMoodYtSuggestions(sessionId: string): Promise<YtSearchResult[]> {
  try {
    const session = await db.moodSession.findUnique({
      where: { id: sessionId },
      select: { freeText: true, mood: { select: { label: true } }, interpretation: true },
    });
    if (!session) return [];
    const interp = session.interpretation as { genreHints?: string[] } | null;
    const moodLabel = session.mood?.label ?? session.freeText ?? "";
    if (!moodLabel) return [];
    return await suggestYtForMood({
      moodLabel,
      genreHints: Array.isArray(interp?.genreHints) ? interp!.genreHints! : [],
      limit: 4,
    });
  } catch {
    return [];
  }
}

/** Adopt a freshly-kept YouTube pick into a mood (Phase 5): record that she
    kept it for this mood — a strong positive that carries the choice into
    future playlists. The track's baseline mood seed (genres + audio-informed)
    is produced by the post-download enrichment once the file lands. */
export async function adoptYtPickIntoMood(sessionId: string, trackId: string): Promise<void> {
  try {
    await applyMoodSignal({ sessionId, trackId, signal: "favorite" });
  } catch {
    /* best-effort */
  }
}
