import { create } from "zustand";
import { usePlayerStore } from "@/stores/player-store";
import { recordMoodSignal } from "@/server/actions/moods";

/**
 * Tracks the active mood session so playback within it can feed learning.
 *
 * Passive complete/skip capture is done via an isolated subscription to the
 * player store (below) — deliberately NOT by editing the shared playback
 * components, so this feature can't interfere with core playback.
 */
type Verdict = "up" | "down";

interface MoodLearningState {
  sessionId: string | null;
  moodLabel: string | null;
  trackIds: Set<string>;
  /** Tracks she's already given an explicit verdict on, so passive capture
      doesn't also fire a (possibly contradictory) skip/complete for them. */
  reacted: Set<string>;
  /** Her explicit verdict per track, so the bar/nudge/menu all show the same
      highlight. */
  reactions: Record<string, Verdict>;
  setSession: (sessionId: string, trackIds: string[], moodLabel?: string) => void;
  clear: () => void;
  markReacted: (trackId: string) => void;
  belongs: (trackId: string) => boolean;
  /** One-tap rating from any surface: records the signal and lights up the
      choice everywhere. No-op outside a mood session. */
  rate: (trackId: string, verdict: Verdict) => void;
}

export const useMoodLearningStore = create<MoodLearningState>((set, get) => ({
  sessionId: null,
  moodLabel: null,
  trackIds: new Set(),
  reacted: new Set(),
  reactions: {},
  setSession: (sessionId, trackIds, moodLabel) =>
    set({
      sessionId,
      moodLabel: moodLabel ?? null,
      trackIds: new Set(trackIds),
      reacted: new Set(),
      reactions: {},
    }),
  clear: () =>
    set({ sessionId: null, moodLabel: null, trackIds: new Set(), reacted: new Set(), reactions: {} }),
  markReacted: (trackId) => set((s) => ({ reacted: new Set(s.reacted).add(trackId) })),
  belongs: (trackId) => get().trackIds.has(trackId),
  rate: (trackId, verdict) => {
    const { sessionId } = get();
    if (!sessionId) return;
    set((s) => ({
      reactions: { ...s.reactions, [trackId]: verdict },
      reacted: new Set(s.reacted).add(trackId),
    }));
    void recordMoodSignal(sessionId, trackId, verdict === "up" ? "thumbUp" : "thumbDown");
  },
}));

const COMPLETE_THRESHOLD = 0.8;

// Isolated passive capture: watch the player for track changes and, when the
// OUTGOING track belonged to the active mood session, record complete (played
// ≥80%) or skip (less). Reads only; never mutates playback. Guarded to the
// browser so server evaluation of this module is inert.
if (typeof window !== "undefined") {
  let lastTrackId: string | null = null;
  let lastMaxPos = 0;
  let lastDuration = 0;

  usePlayerStore.subscribe((state) => {
    const cur = state.queue[state.currentIndex];
    const curId = cur?.id ?? null;

    if (curId === lastTrackId) {
      if (state.position > lastMaxPos) lastMaxPos = state.position;
      return;
    }

    // Track changed — finalize the outgoing one.
    const learning = useMoodLearningStore.getState();
    if (
      lastTrackId &&
      learning.sessionId &&
      learning.trackIds.has(lastTrackId) &&
      !learning.reacted.has(lastTrackId) &&
      lastDuration > 0
    ) {
      const completed = lastMaxPos / lastDuration >= COMPLETE_THRESHOLD;
      void recordMoodSignal(learning.sessionId, lastTrackId, completed ? "complete" : "skip");
    }

    lastTrackId = curId;
    lastMaxPos = state.position;
    lastDuration = cur?.duration ?? 0;
  });
}
