"use client";

import { useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { usePartyStore } from "@/stores/party-store";
import { useFavorite } from "@/hooks/use-favorite";
import { coverUrl } from "@/lib/cover-url";
import {
  ChevronUpIcon,
  HeartIcon,
  HeartOutlineIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  SkipNextIcon,
} from "@/components/icons";

/** Upward drift, in px, that counts as "open the sheet". */
const SWIPE_OPEN_THRESHOLD = 36;

/**
 * The collapsed player — what she looks at almost all the time.
 *
 * Deliberately three controls: heart, play/pause, skip. Shuffle, repeat, the
 * scrubber and the performance toggle all live in the sheet, because none of
 * them is a per-second decision and none of them fits.
 *
 * There is no volume slider, and that is not an omission. iOS makes
 * `HTMLMediaElement.volume` read-only — on an iPhone the desktop slider moves
 * and nothing happens. Volume is the hardware buttons.
 */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const partyLocked = usePartyStore((s) => s.following);
  const { fav, toggle } = useFavorite(track?.id);

  const startY = useRef<number | null>(null);
  const swiped = useRef(false);

  const dur = track?.duration ?? 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;
  const art = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
    swiped.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    const y0 = startY.current;
    const y = e.touches[0]?.clientY;
    if (y0 === null || y === undefined || swiped.current) return;
    if (y0 - y > SWIPE_OPEN_THRESHOLD) {
      // Fire once per gesture. Without the latch the sheet's own open
      // animation competes with further move events from the same swipe.
      swiped.current = true;
      startY.current = null;
      onOpen();
    }
  }

  function onTouchEnd() {
    startY.current = null;
  }

  return (
    <div
      className="kw-pressable relative shrink-0 border-t border-zinc-800/70 bg-zinc-900"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Progress, as a hairline along the top edge — the collapsed bar has no
          room for a scrubber and she can't usefully drag one this thin. */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] bg-sky-500 transition-[width] duration-1000 ease-linear"
        style={{ width: `${pct}%` }}
        aria-hidden
      />

      {/* Swipe affordance. Faded so it reads as a hint rather than a control —
          it isn't tappable, the whole bar already is. */}
      {track && (
        <div className="pointer-events-none flex justify-center pt-1" aria-hidden>
          <ChevronUpIcon size={13} className="text-sky-400/50" />
        </div>
      )}

      <div className="kw-safe-bottom flex items-center gap-3 px-3 pb-2 pt-1">
        {/* Everything except the three buttons opens the sheet. */}
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label="Open now playing"
        >
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
              <MusicNoteIcon size={18} />
            </div>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-100">
              {track?.title ?? "Nothing playing"}
            </span>
            <span className="block truncate text-xs text-zinc-400">
              {track?.artist ?? "Pick a song to start"}
            </span>
          </span>
        </button>

        {track && (
          <button
            type="button"
            onClick={() => void toggle()}
            className={
              "shrink-0 rounded-full p-2 transition " +
              (fav ? "text-red-500" : "text-zinc-500")
            }
            aria-label={fav ? "Unfavorite" : "Favorite"}
          >
            {fav ? <HeartIcon size={19} /> : <HeartOutlineIcon size={19} />}
          </button>
        )}
        <button
          type="button"
          onClick={togglePlay}
          disabled={!track || partyLocked}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-950 transition disabled:opacity-30"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!track || partyLocked}
          className="shrink-0 rounded-full p-2 text-zinc-300 transition disabled:opacity-30"
          aria-label="Next"
        >
          <SkipNextIcon size={21} />
        </button>
      </div>
    </div>
  );
}
