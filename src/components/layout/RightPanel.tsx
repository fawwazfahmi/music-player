"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { QueuePanel } from "@/components/player/QueuePanel";
import { BoltIcon, ChevronLeftIcon } from "@/components/icons";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { coverUrl } from "@/lib/cover-url";

export function RightPanel() {
  // Tab lives in the store, not local state, so the full-video rail's Queue
  // button can switch to it from the other side of the layout.
  const tab = usePlayerStore((s) => s.rightPanelTab);
  const setTab = usePlayerStore((s) => s.setRightPanelTab);
  const currentName = useIpodStore((s) => s.current().name);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const inFullMode = currentName === "nowPlayingFull";

  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);

  return (
    <aside className="flex h-full w-full flex-col bg-zinc-950">
      {/* While the video is on the full-video stage there is nothing to show
          here, so the 16:9 tile collapses to a compact now-playing card — the
          panel is worth more to the lyrics below it than to a dead rectangle.
          When performance mode is on, show the album cover instead of the YT
          iframe (which isn't mounted in that mode anyway). */}
      {inFullMode ? (
        <NowPlayingCard track={track} onBack={pop} />
      ) : (
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {performanceMode ? (
            <PerformanceCover track={track} />
          ) : (
            <>
              {/* VideoStage positions the iframe (z-40) on top of this slot.
                  The iframe has pointer-events:none so clicks pass through. */}
              <div data-video-slot="small" className="absolute inset-0" />
              {/* Click anywhere on the tile to expand to fullscreen */}
              <button
                type="button"
                onClick={() => push({ name: "nowPlayingFull" })}
                className="group absolute inset-0 z-[45] flex items-start justify-end p-2"
                title="Expand to fullscreen"
                aria-label="Expand to fullscreen"
              >
                <span className="rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-zinc-200 opacity-0 backdrop-blur transition group-hover:opacity-100">
                  Expand ⛶
                </span>
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex border-b border-zinc-800/70 text-xs">
        <TabButton label="Lyrics" active={tab === "lyrics"} onClick={() => setTab("lyrics")} />
        <TabButton label="Queue" active={tab === "queue"} onClick={() => setTab("queue")} badge={<QueueBadge />} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Keyed by track: a change remounts, which resets fetch state and any
            open lyric editor without an effect doing it by hand. */}
        {tab === "lyrics" && <LyricsPanel key={track?.id ?? "none"} />}
        {tab === "queue" && <QueuePanel />}
      </div>
    </aside>
  );
}

function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 font-semibold transition " +
        (active
          ? "border-sky-500 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300")
      }
    >
      <span>{label}</span>
      {badge}
    </button>
  );
}

/** Compact stand-in shown while the video is playing on the full-video stage. */
function NowPlayingCard({
  track,
  onBack,
}: {
  track: QueueTrack | null;
  onBack: () => void;
}) {
  const url = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800/70 px-[14px] py-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="h-[52px] w-[52px] shrink-0 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] rounded-full bg-sky-400" />
          <span className="text-[9px] font-semibold uppercase leading-3 tracking-[0.08em] text-zinc-500">
            Playing full screen
          </span>
        </div>
        <div className="mt-0.5 truncate text-[13px] font-semibold leading-[18px] text-zinc-100">
          {track?.title ?? "Nothing playing"}
        </div>
        <div className="truncate text-[11px] leading-[15px] text-zinc-400">
          {track?.artist}
        </div>
      </div>
      <button
        type="button"
        onClick={onBack}
        title="Put the video back in the panel"
        aria-label="Put the video back in the panel"
        className="flex shrink-0 items-center gap-[5px] rounded-full border border-zinc-800 bg-zinc-900 px-[9px] py-[5px] text-[10px] font-semibold leading-[14px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
      >
        <ChevronLeftIcon size={12} />
        <span>Back</span>
      </button>
    </div>
  );
}

function PerformanceCover({ track }: { track: QueueTrack | null }) {
  const url = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
      )}
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-sky-500/90 px-2 py-0.5 text-[10px] font-semibold text-zinc-950">
        <BoltIcon size={10} />
        Perf
      </div>
    </div>
  );
}

function QueueBadge() {
  // Count tracks AFTER the current one — "up next" is the actionable number.
  const upNext = usePlayerStore(
    (s) => Math.max(0, s.queue.length - 1 - s.currentIndex),
  );
  if (upNext === 0) return null;
  return (
    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300">
      {upNext}
    </span>
  );
}
