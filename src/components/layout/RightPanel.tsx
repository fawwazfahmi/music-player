"use client";

import { useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { QueuePanel } from "@/components/player/QueuePanel";
import { BoltIcon, ChevronRightIcon } from "@/components/icons";
import { usePlayerStore } from "@/stores/player-store";
import { coverUrl } from "@/lib/cover-url";

type Tab = "lyrics" | "queue";

export function RightPanel() {
  const [tab, setTab] = useState<Tab>("lyrics");
  const currentName = useIpodStore((s) => s.current().name);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const inFullMode = currentName === "nowPlayingFull";

  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const track = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);

  return (
    <aside className="flex h-full w-full flex-col bg-zinc-950">
      {/* Video slot — when in full mode, this position is empty and shows a hint.
          When performance mode is on, show the album cover instead of the YT
          iframe (which isn't mounted in that mode anyway). */}
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {inFullMode ? (
          <button
            type="button"
            onClick={pop}
            className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ChevronRightIcon size={20} />
            <span className="text-xs">Video in fullscreen</span>
            <span className="text-[10px] text-zinc-500">Tap to exit</span>
          </button>
        ) : performanceMode ? (
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

      <div className="flex border-b border-zinc-800/70 text-xs">
        <TabButton label="Lyrics" active={tab === "lyrics"} onClick={() => setTab("lyrics")} />
        <TabButton label="Queue" active={tab === "queue"} onClick={() => setTab("queue")} badge={<QueueBadge />} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "lyrics" && <LyricsPanel />}
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
          ? "border-emerald-500 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300")
      }
    >
      <span>{label}</span>
      {badge}
    </button>
  );
}

function PerformanceCover({
  track,
}: {
  track: ReturnType<typeof usePlayerStore.getState>["queue"][number] | null;
}) {
  const url = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
      )}
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-zinc-950">
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
