"use client";

import { useEffect, useState } from "react";
import { searchYt, selectYtResult } from "@/server/actions/search";
import type { YtSearchResult } from "@/server/services/yt-service";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface YtPickerProps {
  query: string;
  selected?: number;
}

export function YtPicker({ query, selected = 0 }: YtPickerProps) {
  const [results, setResults] = useState<YtSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void searchYt(query)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Publish row count to Ipod
  useEffect(() => {
    const count = results?.length ?? 0;
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count } }));
  }, [results]);

  // Listen for ipod-select events
  useEffect(() => {
    if (!results) return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ selected: number }>).detail;
      const result = results![detail.selected];
      if (!result) return;
      void selectYtResult(result).then(({ trackId }) => {
        usePlayerStore.getState().setQueue(
          [{
            id: trackId,
            title: result.title,
            duration: result.duration,
            artist: result.uploader,
            album: "YouTube",
          }],
          0,
        );
        useIpodStore.getState().push({ name: "nowPlaying" });
      });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [results]);

  if (error) {
    return (
      <div className="grid h-full place-items-center px-2 text-center text-[10px] text-red-700">
        YT error: {error}
      </div>
    );
  }

  if (results === null) {
    return (
      <div className="grid h-full place-items-center px-2 text-center text-[10px] text-zinc-600">
        Searching YouTube for &ldquo;{query}&rdquo;...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-zinc-600">
        No YouTube results.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        YT: {query}
      </div>
      <div className="flex-1 overflow-auto">
        {results.map((r, i) => (
          <div
            key={r.videoId}
            data-yt-video-id={r.videoId}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-0.5 " +
              (i === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{r.title}</div>
              <div className="truncate text-[9px] opacity-70">{r.uploader}</div>
            </div>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
