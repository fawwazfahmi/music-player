"use client";

import { useMoodLearningStore } from "@/stores/mood-learning-store";
import { ThumbUpIcon, ThumbDownIcon } from "@/components/icons";

/** 👍/👎 for the current-in-mood track. Renders nothing unless a mood session
    is active and this track belongs to it — so the player bar stays exactly as
    it is during normal listening. */
export function MoodThumbs({ trackId, size = 18 }: { trackId: string; size?: number }) {
  const inSession = useMoodLearningStore((s) => !!s.sessionId);
  const belongs = useMoodLearningStore((s) => s.trackIds.has(trackId));
  const reaction = useMoodLearningStore((s) => s.reactions[trackId]);
  const rate = useMoodLearningStore((s) => s.rate);

  if (!inSession || !belongs) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => rate(trackId, "up")}
        aria-label="Fits this mood"
        aria-pressed={reaction === "up"}
        title="Fits this mood"
        className={
          "rounded-full p-1.5 transition " +
          (reaction === "up"
            ? "bg-sky-500/20 text-sky-400"
            : "text-zinc-500 hover:text-zinc-200")
        }
      >
        <ThumbUpIcon size={size} />
      </button>
      <button
        type="button"
        onClick={() => rate(trackId, "down")}
        aria-label="Not this mood"
        aria-pressed={reaction === "down"}
        title="Not this mood"
        className={
          "rounded-full p-1.5 transition " +
          (reaction === "down"
            ? "bg-red-500/20 text-red-400"
            : "text-zinc-500 hover:text-zinc-200")
        }
      >
        <ThumbDownIcon size={size} />
      </button>
    </div>
  );
}
