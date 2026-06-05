"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";
import { getLyrics, type GetLyricsResult } from "@/server/actions/lyrics";

export function LyricsPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const position = usePlayerStore((s) => s.position);
  const track = queue[currentIndex] ?? null;

  const [data, setData] = useState<GetLyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch lyrics on track change
  useEffect(() => {
    if (!track) {
      setData(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void getLyrics(track.id)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  // Find the active line index based on current position
  const activeIndex = useMemo(() => {
    if (!data || data.synced.length === 0) return -1;
    let lo = 0;
    let hi = data.synced.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = data.synced[mid]!.time;
      if (t <= position) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }, [data, position]);

  // Auto-scroll the active line into view
  useEffect(() => {
    if (activeIndex < 0 || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLDivElement>(
      `[data-line-idx="${activeIndex}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  function jumpTo(line: number) {
    const seconds = data?.synced[line]?.time;
    if (typeof seconds !== "number") return;
    getEngine().seek(seconds);
    usePlayerStore.setState({ position: seconds });
  }

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Nothing playing
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading lyrics…
      </div>
    );
  }

  if (data?.instrumental) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Instrumental
      </div>
    );
  }

  if (!data || (data.synced.length === 0 && !data.plain)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-zinc-500">
        <span>No lyrics found</span>
        <span className="text-xs text-zinc-600">via LRCLIB</span>
      </div>
    );
  }

  // Synced view (preferred)
  if (data.synced.length > 0) {
    return (
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-6 py-12 scrollbar-thin scrollbar-thumb-zinc-700"
      >
        {data.synced.map((line, i) => (
          <button
            key={`${i}-${line.time}`}
            type="button"
            data-line-idx={i}
            onClick={() => jumpTo(i)}
            className={
              "block w-full cursor-pointer rounded px-2 py-2 text-left text-base transition-all duration-200 " +
              (i === activeIndex
                ? "scale-105 font-bold text-zinc-100"
                : i < activeIndex
                  ? "text-zinc-600 hover:text-zinc-400"
                  : "text-zinc-500 hover:text-zinc-300")
            }
          >
            {line.text || "♪"}
          </button>
        ))}
      </div>
    );
  }

  // Plain text fallback
  return (
    <div className="h-full overflow-y-auto whitespace-pre-wrap px-6 py-8 text-base leading-relaxed text-zinc-400">
      {data.plain}
    </div>
  );
}
