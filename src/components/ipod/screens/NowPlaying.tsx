"use client";

import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

export function NowPlaying() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const track = queue[currentIndex] ?? null;

  if (!track) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-[11px]">Nothing playing.</div>
      </div>
    );
  }

  const progress = track.duration > 0 ? Math.min(1, position / track.duration) : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Now Playing
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden p-2">
        <div className="h-16 w-16 shrink-0 rounded-sm bg-gradient-to-br from-[#5b7fb8] to-[#2a3a55] shadow-md" />
        <div className="mt-1 line-clamp-2 w-full break-words text-center text-[11px] font-semibold leading-tight">
          {track.title}
        </div>
        <div className="w-full truncate text-center text-[10px] text-zinc-700">{track.artist}</div>
        <div className="w-full truncate text-center text-[9px] text-zinc-600">{track.album}</div>
        <div className="mt-2 w-[95%]">
          <div className="h-1 w-full rounded bg-black/20">
            <div className="h-full rounded bg-black/70" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-zinc-700">
            <span>{formatDuration(position)}</span>
            <span className="flex gap-1">
              {shuffle && <span>⇄</span>}
              {repeat !== "off" && <span>{repeat === "one" ? "🔂" : "🔁"}</span>}
              {!isPlaying && <span>⏸</span>}
            </span>
            <span>−{formatDuration(Math.max(0, track.duration - position))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
