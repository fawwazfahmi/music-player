"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { usePartyStore } from "@/stores/party-store";
import { getEngine } from "@/audio/engine";
import { useFavorite } from "@/hooks/use-favorite";
import { coverUrl } from "@/lib/cover-url";
import { formatDuration } from "@/lib/format-duration";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { QueuePanel } from "@/components/player/QueuePanel";
import {
  BoltIcon,
  HeartIcon,
  HeartOutlineIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/components/icons";

/** Downward drag past this closes the sheet on release. */
const CLOSE_THRESHOLD_PX = 110;

type Tab = "lyrics" | "queue";

/**
 * Full-screen now playing, reached by swiping up on the mini player.
 *
 * Layout, top to bottom: media slot, tabs, lyrics/queue, then the controls.
 * Controls sit BELOW the lyrics on purpose — that is where her thumb already
 * is, and it hands the lyrics the ~70px they would otherwise lose to a
 * transport row wedged under the video.
 *
 * The media slot is 16:9 for video because YouTube requires it, but album art
 * is square and shrinks to 150px, so art mode gives roughly three extra lines
 * of lyrics. Everything below the slot is identical between the two states, so
 * toggling the bolt slides the lyrics and moves nothing else.
 */
export function NowPlayingSheet({
  open,
  onClose,
  artMode,
}: {
  open: boolean;
  onClose: () => void;
  /** Effective art mode — performance mode forces this on. */
  artMode: boolean;
}) {
  const [tab, setTab] = useState<Tab>("lyrics");
  // `dragY` drives the transform; `dragging` decides whether the transform is
  // animated. Both are state rather than refs because both are read during
  // render — a ref would leave the sheet a frame behind the finger.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);

  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const mobileArtMode = usePlayerStore((s) => s.mobileArtMode);
  const setMobileArtMode = usePlayerStore((s) => s.setMobileArtMode);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const partyLocked = usePartyStore((s) => s.following);
  const { fav, toggle } = useFavorite(track?.id);

  // Escape closes it. Only meaningful when testing at desktop width, but it
  // costs three lines and means the sheet is never a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function onDragStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0]?.clientY ?? null;
    setDragging(true);
  }

  function onDragMove(e: React.TouchEvent) {
    const y0 = dragStartY.current;
    const y = e.touches[0]?.clientY;
    if (y0 === null || y === undefined) return;
    // Downward only. Dragging up would lift the sheet off the top of the
    // screen, which is nowhere.
    setDragY(Math.max(0, y - y0));
  }

  // Always lands back at 0, whether it closed or sprang back — so the next
  // open never starts from a stale offset and no effect is needed to reset it.
  function onDragEnd() {
    dragStartY.current = null;
    setDragging(false);
    if (dragY > CLOSE_THRESHOLD_PX) onClose();
    setDragY(0);
  }

  function seekTo(seconds: number) {
    if (!track) return;
    getEngine().seek(seconds);
    usePlayerStore.setState({ position: seconds });
  }

  const dur = track?.duration ?? 0;
  const art = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      aria-hidden={!open}
      className={
        "fixed inset-0 z-[70] flex flex-col bg-zinc-950 md:hidden " +
        (dragging ? "" : "transition-transform duration-300 ease-out ") +
        (open ? "" : "pointer-events-none")
      }
      style={{ transform: open ? `translateY(${dragY}px)` : "translateY(100%)" }}
    >
      {/* ── Drag region: handle + media slot ───────────────────────────────
          Only this area drags. If the whole sheet did, scrolling the lyrics
          would fight the dismiss gesture on every flick. */}
      <div
        className="kw-safe-top kw-pressable shrink-0"
        onTouchStart={onDragStart}
        onTouchMove={onDragMove}
        onTouchEnd={onDragEnd}
        onTouchCancel={onDragEnd}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center justify-center py-2.5"
          aria-label="Close now playing"
        >
          <span className="h-1 w-9 rounded-full bg-zinc-700" />
        </button>

        <div className="relative border-y border-zinc-800/70 bg-black">
          {artMode ? (
            <div className="flex h-[150px] items-center justify-center bg-zinc-950">
              {art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={art}
                  alt=""
                  className="h-full w-[150px] rounded-lg object-cover shadow-lg"
                />
              ) : (
                <div className="flex h-full w-[150px] items-center justify-center rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
                  <MusicNoteIcon size={40} />
                </div>
              )}
            </div>
          ) : (
            // VideoStage positions the shared iframe over this slot. It is only
            // in the DOM while the sheet is open, which is what stops the phone
            // decoding video for a whole listening session.
            <div data-video-slot="sheet" className="aspect-video w-full" />
          )}

          <BoltChip
            lit={artMode}
            locked={performanceMode}
            onToggle={() => setMobileArtMode(!mobileArtMode)}
          />
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-zinc-800/70 text-xs">
        <TabButton label="Lyrics" active={tab === "lyrics"} onClick={() => setTab("lyrics")} />
        <TabButton label="Queue" active={tab === "queue"} onClick={() => setTab("queue")} />
      </div>

      {/* ── Lyrics / Queue ─────────────────────────────────────────────── */}
      <div className="kw-contain-scroll min-h-0 flex-1 overflow-hidden">
        {tab === "lyrics" ? <LyricsPanel key={track?.id ?? "none"} /> : <QueuePanel />}
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="kw-safe-bottom shrink-0 border-t border-zinc-800/70 bg-zinc-950 pt-2.5">
        <div className="flex items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-zinc-100">
              {track?.title ?? "Nothing playing"}
            </div>
            <div className="truncate text-xs text-zinc-400">{track?.artist ?? ""}</div>
          </div>
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
              {fav ? <HeartIcon size={20} /> : <HeartOutlineIcon size={20} />}
            </button>
          )}
        </div>

        <div className="mt-2 px-4">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur))}
            value={Math.min(Math.floor(position), Math.floor(dur))}
            onChange={(e) => seekTo(Number(e.target.value))}
            disabled={!track || partyLocked}
            className="w-full accent-sky-400 disabled:opacity-40"
            aria-label="Seek"
          />
          <div className="-mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
            <span>{formatDuration(position)}</span>
            <span>{formatDuration(dur)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 px-4 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => setShuffle(!shuffle)}
            disabled={partyLocked}
            aria-pressed={shuffle}
            className={
              "rounded-full p-2 transition disabled:opacity-30 " +
              (shuffle ? "text-sky-400" : "text-zinc-500")
            }
            aria-label="Shuffle"
          >
            <ShuffleIcon size={18} />
          </button>
          <button
            type="button"
            onClick={prev}
            disabled={!track || partyLocked}
            className="rounded-full p-2 text-zinc-200 transition disabled:opacity-30"
            aria-label="Previous"
          >
            <SkipPreviousIcon size={26} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!track || partyLocked}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-950 transition disabled:opacity-30"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!track || partyLocked}
            className="rounded-full p-2 text-zinc-200 transition disabled:opacity-30"
            aria-label="Next"
          >
            <SkipNextIcon size={26} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            disabled={partyLocked}
            className={
              "rounded-full p-2 transition disabled:opacity-30 " +
              (repeat !== "off" ? "text-sky-400" : "text-zinc-500")
            }
            aria-label={`Repeat ${repeat}`}
          >
            {repeat === "one" ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The one control in the slot: bolt lit means no video.
 *
 * Same icon performance mode uses, so the two read as one idea rather than two
 * unrelated switches. When performance mode owns the decision the chip stays
 * lit and stops responding — flipping it here would silently contradict a
 * setting made elsewhere.
 */
function BoltChip({
  lit,
  locked,
  onToggle,
}: {
  lit: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onToggle}
      disabled={locked}
      aria-pressed={lit}
      aria-label={
        locked
          ? "Performance mode is on — video stays off"
          : lit
            ? "Show the video"
            : "Show album art instead"
      }
      title={
        locked
          ? "Performance mode is on — video stays off"
          : lit
            ? "Show the video"
            : "Show album art instead"
      }
      className={
        "absolute right-2 top-2 z-[45] flex h-8 w-8 items-center justify-center rounded-full transition " +
        (lit
          ? "bg-sky-500 text-zinc-950"
          : "border border-zinc-700 bg-zinc-900/80 text-zinc-300 backdrop-blur") +
        (locked ? " opacity-70" : "")
      }
    >
      <BoltIcon size={15} />
    </button>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 border-b-2 py-2.5 font-semibold transition " +
        (active ? "border-sky-500 text-zinc-100" : "border-transparent text-zinc-500")
      }
    >
      {label}
    </button>
  );
}
