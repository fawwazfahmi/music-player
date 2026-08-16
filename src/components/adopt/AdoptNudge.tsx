"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAdoptStore } from "@/stores/adopt-store";
import { useMoodLearningStore } from "@/stores/mood-learning-store";
import { adoptTrack } from "@/server/actions/library";
import { adoptYtPickIntoMood } from "@/server/actions/moods";
import { shouldShowAdoptNudge, ADOPT_NUDGE_GAP } from "@/lib/adopt-nudge";
import { CloseIcon } from "@/components/icons";

/** "Feeling this one? Add it to Kyowave" — the keep prompt for an ephemeral
    YouTube pick. Mounted once, globally; renders nothing unless the current
    track is an un-kept ephemeral pick past the thresholds. */
export function AdoptNudge() {
  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const position = usePlayerStore((s) => s.position);
  const markTrackAdopted = usePlayerStore((s) => s.markTrackAdopted);
  const adopted = useAdoptStore((s) => (track ? s.adopted.has(track.id) : false));
  const dismissed = useAdoptStore((s) => (track ? s.dismissed.has(track.id) : false));
  const dismiss = useAdoptStore((s) => s.dismiss);
  const markAdopted = useAdoptStore((s) => s.markAdopted);
  const sessionId = useMoodLearningStore((s) => s.sessionId);

  const [sinceNudge, setSinceNudge] = useState(ADOPT_NUDGE_GAP);
  const lastTrackId = useRef<string | null>(null);

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
  const show = shouldShowAdoptNudge({
    isEphemeral: !!track.ephemeral,
    adopted,
    dismissed,
    progress,
    songsSinceNudge: sinceNudge,
  });
  if (!show) return null;

  const currentId = track.id;

  async function add() {
    markAdopted(currentId); // suppress immediately
    markTrackAdopted(currentId);
    setSinceNudge(0);
    try {
      await adoptTrack(currentId);
      // Keeping inside a mood session teaches taste for that mood.
      if (sessionId) void adoptYtPickIntoMood(sessionId, currentId);
    } catch {
      /* best-effort — the flag is already flipped locally */
    }
  }

  function notNow() {
    dismiss(currentId);
    setSinceNudge(0);
  }

  return (
    <div className="pointer-events-none flex justify-center px-3 pb-2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-sky-500/40 bg-sky-950/90 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-sm text-sky-100">Feeling this one? Add it to Kyowave</span>
        <button
          type="button"
          onClick={() => void add()}
          className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-sky-400"
        >
          Add
        </button>
        <button
          type="button"
          onClick={notNow}
          aria-label="Not now"
          className="rounded-full p-1 text-sky-300/60 transition hover:text-sky-100"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
