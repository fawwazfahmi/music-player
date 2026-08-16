"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { usePartyStore } from "@/stores/party-store";
import { useIpodStore } from "@/stores/ipod-store";
import { getEngine } from "@/audio/engine";
import { coverUrl } from "@/lib/cover-url";
import { formatDuration } from "@/lib/format-duration";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";
import { PerformanceModeDialog } from "@/components/player/PerformanceModeDialog";
import {
  BoltIcon,
  CloseIcon,
  HeartIcon,
  HeartOutlineIcon,
  MusicNoteIcon,
  QueueIcon,
} from "@/components/icons";

// Full video mode — the immersive stage reached from the sidebar's Now Playing
// item, the right-panel video tile, or YtVideoPanel's expand overlay.
//
// The video is the largest 16:9 the pane can hold, floating in a blur of the
// track's own cover art. Chrome is deliberately quiet but never hides: no
// mouse-idle timers, no auto-fading controls. Lyrics stay in the right panel.

export function NowPlayingFullPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const videoLoading = usePlayerStore((s) => s.videoLoading);
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const track = queue[currentIndex] ?? null;
  // In performance mode (no YT iframe), treat YT tracks like local tracks —
  // render the cover art tile instead of the video slot div.
  const showVideoTile = !!track?.ytVideoId && !performanceMode;
  const cover = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* Ambient bloom of the track's own art. Nothing to bloom without a
          track, so the empty state gets a plain zinc-950 pane. */}
      {track && <AmbientLayer cover={cover} />}

      {track && <StageHeader track={track} />}

      {/* `container-type: size` makes this row a query container so the video
          box can size itself off the row's own height (100cqh) rather than a
          `100dvh - <guessed chrome>` approximation. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-[70px] pb-[26px] pt-[22px]"
        style={{ containerType: "size" }}
      >
        {!track ? (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <MusicNoteIcon size={48} />
            <p className="text-sm">Pick a song to see it here.</p>
          </div>
        ) : !showVideoTile ? (
          <div className="flex max-h-full max-w-full flex-col items-center gap-4">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className="max-h-[62vh] max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-zinc-800"
              />
            ) : (
              <div className="flex aspect-square h-[62vh] max-h-full items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500 shadow-2xl ring-1 ring-zinc-800">
                <MusicNoteIcon size={96} />
              </div>
            )}
            <p className="text-sm text-zinc-500">
              {performanceMode
                ? "Performance mode — video hidden"
                : "No video for this track"}
            </p>
          </div>
        ) : (
          // This div is the slot the global VideoStage will overlay onto.
          //
          // Width-driven on purpose: a height-driven aspect-ratio box gets
          // squeezed by the flex parent and loses its ratio.
          //
          // The width has to carry the height cap itself. `max-height:100%`
          // looks like it should work, but with a definite `width:100%` the
          // clamp does NOT transfer back through the aspect ratio — the box
          // just goes wide (measured 16:8.8 at 1500x620), and VideoStage then
          // hands the iframe a rect that isn't 16:9. Capping the width against
          // the row's own height via `100cqh` binds whichever axis runs out
          // first and keeps the ratio exact in both.
          <div
            data-video-slot="big"
            className="relative m-auto overflow-hidden rounded-[14px] bg-black"
            style={{
              width: "min(100%, 1600px, calc(100cqh * 16 / 9))",
              aspectRatio: "16 / 9",
              boxShadow: "0 34px 90px rgba(0,0,0,0.6)",
              outline: "1px solid rgba(63,63,70,0.7)",
              outlineOffset: "-1px",
            }}
          >
            {videoLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-sm text-zinc-300">
                Loading video…
              </div>
            )}
          </div>
        )}
      </div>

      <ActionRail track={track} />
    </div>
  );
}

function AmbientLayer({ cover }: { cover: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute"
        style={{
          left: "-8%",
          top: "-8%",
          width: "116%",
          height: "116%",
          filter: "blur(80px)",
          opacity: 0.6,
        }}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-zinc-700 to-zinc-900" />
        )}
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(100% 65% at 50% 45%, rgba(14,165,233,0.16), rgba(9,9,11,0) 62%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(9,9,11,0.25), rgba(9,9,11,0.72))",
        }}
      />
    </div>
  );
}

/** Quiet meta + scrubber strip. Replaces the old `Now Playing` header block. */
function StageHeader({ track }: { track: QueueTrack }) {
  return (
    <div className="relative flex items-center justify-between gap-4 px-[26px] pb-0 pt-5">
      <div className="min-w-0">
        <div className="flex items-center gap-[7px]">
          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-sky-400" />
          <span className="whitespace-nowrap text-[10px] font-semibold uppercase leading-[14px] tracking-[0.1em] text-zinc-500">
            Now playing
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span className="truncate text-[19px] font-semibold leading-[26px] tracking-[-0.01em] text-zinc-100">
            {track.title}
          </span>
          <span className="truncate text-[13px] leading-5 text-zinc-400">
            {track.artist}
          </span>
        </div>
      </div>
      <Scrubber duration={track.duration} />
    </div>
  );
}

/**
 * 160px seek bar. Same contract as the player bar's range input — click or
 * drag sets the engine time and the store position — and the same party lock:
 * while following a broadcaster, playback is theirs to move, not ours.
 */
function Scrubber({ duration }: { duration: number }) {
  const position = usePlayerStore((s) => s.position);
  const partyLocked = usePartyStore((s) => s.following);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const dur = duration > 0 ? duration : 0;
  const pct = dur > 0 ? Math.min(1, Math.max(0, position / dur)) : 0;

  function seekFrom(clientX: number) {
    const el = trackRef.current;
    if (!el || dur <= 0) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const t = ((clientX - r.left) / r.width) * dur;
    const clamped = Math.min(dur, Math.max(0, t));
    getEngine().seek(clamped);
    usePlayerStore.setState({ position: clamped });
  }

  return (
    <div
      className={
        "flex items-center gap-[9px] text-[11px] leading-[15px] text-zinc-500 " +
        (partyLocked ? "opacity-40" : "")
      }
    >
      <span className="shrink-0 tabular-nums">{formatDuration(position)}</span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(dur))}
        aria-valuenow={Math.floor(Math.min(position, dur))}
        aria-disabled={partyLocked || dur <= 0}
        tabIndex={partyLocked || dur <= 0 ? -1 : 0}
        // Padded vertically so a 3px bar is still an easy target, while the
        // painted track stays 3px.
        // 160px at the width this was designed for, but allowed to compress:
        // `main` is only ~220px wide at the `md` breakpoint, and a rigid bar
        // there squeezes the title down to an ellipsis.
        className={
          "relative h-3 w-[160px] min-w-[56px] " +
          (partyLocked || dur <= 0 ? "cursor-default" : "cursor-pointer")
        }
        onPointerDown={(e) => {
          if (partyLocked || dur <= 0) return;
          // Seek first. Capture is only there to keep a drag tracking the
          // cursor once it leaves the 160px bar; when it throws — which it
          // does for synthetic pointers with no active pointer id — a plain
          // click must still land, so it must not gate the seek.
          seekFrom(e.clientX);
          setDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* drag will simply stop tracking outside the bar */
          }
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          seekFrom(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          setDragging(false);
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* never captured — nothing to release */
          }
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (partyLocked || dur <= 0) return;
          const step = e.shiftKey ? 15 : 5;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.key === "ArrowRight" ? step : -step;
            const t = Math.min(dur, Math.max(0, position + delta));
            getEngine().seek(t);
            usePlayerStore.setState({ position: t });
          }
        }}
      >
        <div
          className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ background: "rgba(63,63,70,0.7)" }}
        >
          <div
            className="h-[3px] rounded-full bg-sky-500"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 tabular-nums">{formatDuration(dur)}</span>
    </div>
  );
}

/**
 * Right-edge glass rail. Sits at z-45 because the VideoStage container is a
 * position:fixed z-40 overlay — the same trick the right panel's expand button
 * already uses to stay clickable over the iframe.
 */
function ActionRail({ track }: { track: QueueTrack | null }) {
  const pop = useIpodStore((s) => s.pop);
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const setPerformanceMode = usePlayerStore((s) => s.setPerformanceMode);
  const setRightPanelTab = usePlayerStore((s) => s.setRightPanelTab);
  const [fav, setFav] = useState(false);
  const [confirmingPerf, setConfirmingPerf] = useState(false);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    void isFavorited("TRACK", track.id).then((f) => {
      if (!cancelled) setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [track]);

  useEffect(() => {
    function handler() {
      if (!track) return;
      void isFavorited("TRACK", track.id).then(setFav);
    }
    window.addEventListener("ipod-fav-changed", handler);
    return () => window.removeEventListener("ipod-fav-changed", handler);
  }, [track]);

  async function onToggleFav() {
    if (!track) return;
    const newFav = await toggleFavorite("TRACK", track.id);
    setFav(newFav);
    window.dispatchEvent(new CustomEvent("ipod-fav-changed"));
  }

  // Explain the mode on the way in only — turning it back off restores
  // everything and needs no confirmation. Same as PlayerBar's toggle.
  function onTogglePerf() {
    if (performanceMode) setPerformanceMode(false);
    else setConfirmingPerf(true);
  }

  const base =
    "flex h-[34px] w-[34px] items-center justify-center rounded-full transition";

  return (
    <>
      <div className="absolute right-[18px] top-1/2 z-[45] flex -translate-y-1/2 flex-col gap-1 rounded-full border border-[rgba(63,63,70,0.55)] bg-[rgba(24,24,27,0.6)] px-1.5 py-2 backdrop-blur-[14px]">
        <button
          type="button"
          onClick={pop}
          title="Exit full video"
          aria-label="Exit full video"
          className={base + " text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}
        >
          <CloseIcon size={17} />
        </button>
        {track && (
          <button
            type="button"
            onClick={onToggleFav}
            aria-pressed={fav}
            title={fav ? "Unfavorite" : "Favorite"}
            aria-label={fav ? "Unfavorite" : "Favorite"}
            className={
              base +
              (fav
                ? " text-red-500 hover:bg-zinc-800"
                : " text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100")
            }
          >
            {fav ? <HeartIcon size={17} /> : <HeartOutlineIcon size={17} />}
          </button>
        )}
        {track && (
          <button
            type="button"
            onClick={() => setRightPanelTab("queue")}
            title="Show the queue"
            aria-label="Show the queue"
            className={base + " text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}
          >
            <QueueIcon size={17} />
          </button>
        )}
        <button
          type="button"
          onClick={onTogglePerf}
          aria-pressed={performanceMode}
          title={
            performanceMode
              ? "Performance mode on — video hidden. Click to disable."
              : "Performance mode off — full UI. Click to enable for gaming."
          }
          aria-label="Performance mode"
          className={
            base +
            (performanceMode
              ? " bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
              : " text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300")
          }
        >
          <BoltIcon size={17} />
        </button>
      </div>
      <PerformanceModeDialog
        open={confirmingPerf}
        onCancel={() => setConfirmingPerf(false)}
        onConfirm={() => {
          setPerformanceMode(true);
          setConfirmingPerf(false);
        }}
      />
    </>
  );
}
