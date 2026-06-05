"use client";

import { useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { ChevronRightIcon } from "@/components/icons";

type Tab = "lyrics" | "video";

export function RightPanel() {
  const [tab, setTab] = useState<Tab>("lyrics");
  const currentName = useIpodStore((s) => s.current().name);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const inFullMode = currentName === "nowPlayingFull";

  return (
    <aside className="flex h-full w-full flex-col bg-zinc-950">
      {/* Video slot — when in full mode, this position is empty and shows a hint */}
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
        <button
          type="button"
          onClick={() => setTab("lyrics")}
          className={
            "flex-1 border-b-2 px-3 py-2 font-semibold transition " +
            (tab === "lyrics"
              ? "border-emerald-500 text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-300")
          }
        >
          Lyrics
        </button>
        <button
          type="button"
          disabled
          className="flex-1 border-b-2 border-transparent px-3 py-2 font-semibold text-zinc-700"
          title="Queue view coming soon"
        >
          Queue
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "lyrics" && <LyricsPanel />}
      </div>
    </aside>
  );
}
