"use client";

import { useState } from "react";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { YtVideoPanel } from "@/components/player/YtVideoPanel";

type Tab = "lyrics" | "video";

export function RightPanel() {
  const [tab, setTab] = useState<Tab>("lyrics");

  return (
    <aside className="flex h-full w-full flex-col bg-zinc-950">
      <div className="aspect-video w-full overflow-hidden bg-black">
        <YtVideoPanel />
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
