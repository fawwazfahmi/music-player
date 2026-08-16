"use server";

import { getAllMoods } from "@/server/services/mood-store";
import { runMoodSession, type MoodSessionResult } from "@/server/services/mood-session";
import { applyMoodSignal, type MoodSignal } from "@/server/services/mood-learning";
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
