"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useMoodLearningStore } from "@/stores/mood-learning-store";
import { shouldShowNudge, NUDGE_GAP } from "@/lib/mood-nudge";
import { ThumbUpIcon, ThumbDownIcon, CloseIcon } from "@/components/icons";

/** The "was this a <mood> vibe?" check-in. Appears above the player only when
    it's worth asking (see shouldShowNudge) and never nags. Mounted once,
    globally; renders nothing outside a mood session. */
export function MoodNudge() {
  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const position = usePlayerStore((s) => s.position);
  const sessionId = useMoodLearningStore((s) => s.sessionId);
  const moodLabel = useMoodLearningStore((s) => s.moodLabel);
  const belongs = useMoodLearningStore((s) => (track ? s.trackIds.has(track.id) : false));
  const reacted = useMoodLearningStore((s) => (track ? s.reacted.has(track.id) : false));
  const rate = useMoodLearningStore((s) => s.rate);

  // Songs since the last nudge (start "ready" so the first eligible one shows).
  const [sinceNudge, setSinceNudge] = useState(NUDGE_GAP);
  const lastTrackId = useRef<string | null>(null);
  const [handledTrack, setHandledTrack] = useState<string | null>(null);

  const trackId = track?.id ?? null;
  useEffect(() => {
    if (trackId !== lastTrackId.current) {
      if (lastTrackId.current !== null) setSinceNudge((n) => n + 1);
      lastTrackId.current = trackId;
    }
  }, [trackId]);

  if (!track) return null;

  const dur = track.duration || 0;
  const progress = dur > 0 ? position / dur : 0;
  const handled = handledTrack === track.id;
  const show =
    !handled &&
    shouldShowNudge({
      inSession: !!sessionId,
      belongs,
      reacted,
      progress,
      songsSinceNudge: sinceNudge,
    });
  if (!show) return null;

  const currentId = track.id;
  function done(action?: () => void) {
    action?.();
    setHandledTrack(currentId);
    setSinceNudge(0);
  }

  return (
    <div className="pointer-events-none flex justify-center px-3 pb-2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-sky-500/40 bg-sky-950/90 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-sm text-sky-100">
          Was this {moodLabel ? `a ${moodLabel}` : "your"} vibe?
        </span>
        <button
          type="button"
          onClick={() => done(() => rate(currentId, "up"))}
          aria-label="Fits this mood"
          className="rounded-full p-1 text-sky-300 transition hover:bg-sky-500/20 hover:text-sky-100"
        >
          <ThumbUpIcon size={17} />
        </button>
        <button
          type="button"
          onClick={() => done(() => rate(currentId, "down"))}
          aria-label="Not this mood"
          className="rounded-full p-1 text-sky-300 transition hover:bg-sky-500/20 hover:text-sky-100"
        >
          <ThumbDownIcon size={17} />
        </button>
        <button
          type="button"
          onClick={() => done()}
          aria-label="Dismiss"
          className="rounded-full p-1 text-sky-300/60 transition hover:text-sky-100"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
