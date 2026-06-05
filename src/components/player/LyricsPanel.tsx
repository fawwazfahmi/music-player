"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";
import {
  getLyrics,
  transcribeTrack,
  type GetLyricsResult,
} from "@/server/actions/lyrics";

export function LyricsPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const position = usePlayerStore((s) => s.position);
  const track = queue[currentIndex] ?? null;

  const [data, setData] = useState<GetLyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch lyrics on track change
  useEffect(() => {
    if (!track) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
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

  async function handleTranscribe() {
    if (!track) return;
    setTranscribing(true);
    setError(null);
    try {
      const result = await transcribeTrack(track.id);
      setData({
        trackId: result.trackId,
        synced: result.synced,
        plain: result.plain,
        instrumental: false,
        source: "cache",
        lyricsSource: "WHISPER",
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }

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

  if (transcribing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-zinc-400">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <span>Transcribing with Whisper…</span>
        <span className="text-xs text-zinc-600">This usually takes 20–60s</span>
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

  const hasLyrics = data && (data.synced.length > 0 || !!data.plain);

  if (!hasLyrics) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-zinc-500">
        <div className="flex flex-col gap-1">
          <span>No lyrics found</span>
          <span className="text-xs text-zinc-600">via LRCLIB</span>
        </div>
        <button
          type="button"
          onClick={handleTranscribe}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          Transcribe with AI
        </button>
        {error && <span className="max-w-xs text-xs text-red-400">{error}</span>}
        <span className="max-w-xs text-[10px] text-zinc-700">
          Uses Whisper running locally on your machine
        </span>
      </div>
    );
  }

  const isWhisper = data?.lyricsSource === "WHISPER";

  // Synced view (preferred)
  if (data && data.synced.length > 0) {
    return (
      <div className="flex h-full flex-col">
        <LyricsHeader source={data.lyricsSource} onReTranscribe={handleTranscribe} />
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-12 scrollbar-thin scrollbar-thumb-zinc-700"
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
                  ? `scale-105 font-bold ${isWhisper ? "text-emerald-200" : "text-zinc-100"}`
                  : i < activeIndex
                    ? "text-zinc-600 hover:text-zinc-400"
                    : "text-zinc-500 hover:text-zinc-300")
              }
            >
              {line.text || "♪"}
            </button>
          ))}
          {error && <p className="px-2 py-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // Plain text fallback
  return (
    <div className="flex h-full flex-col">
      <LyricsHeader source={data?.lyricsSource ?? null} onReTranscribe={handleTranscribe} />
      <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-6 py-8 text-base leading-relaxed text-zinc-400">
        {data?.plain}
      </div>
      {error && <p className="px-6 pb-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function LyricsHeader({
  source,
  onReTranscribe,
}: {
  source: GetLyricsResult["lyricsSource"];
  onReTranscribe: () => void;
}) {
  const isWhisper = source === "WHISPER";
  return (
    <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2 text-[10px] uppercase tracking-wider">
      <span
        className={
          isWhisper
            ? "rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300"
            : "text-zinc-500"
        }
      >
        {isWhisper ? "AI-generated · Whisper" : "LRCLIB"}
      </span>
      <button
        type="button"
        onClick={onReTranscribe}
        className="rounded-full px-2 py-0.5 font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        title="Replace these lyrics with a fresh Whisper transcription"
      >
        Re-transcribe
      </button>
    </div>
  );
}
