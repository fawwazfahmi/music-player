"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";
import {
  getLyrics,
  transcribeTrack,
  updateSyncedLyrics,
  type GetLyricsResult,
} from "@/server/actions/lyrics";
import type { LyricLine } from "@/server/services/lrclib";

function formatLrcTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `[${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}]`;
}

function rebuildLrc(lines: LyricLine[]): string {
  return lines.map((l) => `${formatLrcTime(l.time)}${l.text}`).join("\n");
}

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

  // Inline-edit state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextMenu, setContextMenu] = useState<
    { idx: number; x: number; y: number } | null
  >(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Fetch lyrics on track change. If the server reports it kicked off an
  // auto-transcription, re-poll every 4s until it lands so the user doesn't
  // need to navigate away and back.
  useEffect(() => {
    if (!track) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;
    const trackId = track.id;

    function schedulePoll() {
      pollHandle = setTimeout(fetchOnce, 4000);
    }

    function fetchOnce() {
      void getLyrics(trackId)
        .then((r) => {
          if (cancelled) return;
          setData(r);
          if (r.autoTranscribing) {
            schedulePoll();
          }
        })
        .catch((e) => {
          if (!cancelled) console.error("[mu] getLyrics failed", e);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    fetchOnce();

    return () => {
      cancelled = true;
      if (pollHandle !== null) clearTimeout(pollHandle);
    };
  }, [track?.id]);

  // Reset edit state on track change so we don't bleed an open editor across
  // tracks.
  useEffect(() => {
    setEditingIdx(null);
    setContextMenu(null);
  }, [track?.id]);

  // Context-menu dismissal — outside click + Escape.
  useEffect(() => {
    if (!contextMenu) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-lyrics-context-menu]")) return;
      setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Auto-focus the input when an edit starts.
  useEffect(() => {
    if (editingIdx !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingIdx]);

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
        autoTranscribing: false,
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const headline = raw.split("\n")[0]?.slice(0, 160) ?? "Transcription failed";
      setError(headline);
      console.error("Transcription failed:", e);
    } finally {
      setTranscribing(false);
    }
  }

  function onContextMenu(e: React.MouseEvent, idx: number) {
    e.preventDefault();
    setContextMenu({ idx, x: e.clientX, y: e.clientY });
  }

  function beginEdit(idx: number) {
    if (!data || !data.synced[idx]) return;
    setEditingIdx(idx);
    setEditValue(data.synced[idx]!.text);
    setContextMenu(null);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditValue("");
  }

  async function saveEdit() {
    if (editingIdx === null || !data || !track) return;
    const idx = editingIdx;
    const newText = editValue;
    const original = data.synced[idx]?.text ?? "";
    if (newText === original) {
      cancelEdit();
      return;
    }
    // Optimistic update — snap the line immediately, revert if the server
    // rejects it.
    const nextLines: LyricLine[] = data.synced.map((l, i) =>
      i === idx ? { ...l, text: newText } : l,
    );
    setData({ ...data, synced: nextLines });
    setEditingIdx(null);
    setEditValue("");
    setError(null);
    try {
      const lrc = rebuildLrc(nextLines);
      await updateSyncedLyrics(track.id, lrc);
    } catch (e) {
      console.error("[mu] updateSyncedLyrics failed", e);
      setError("Save failed — change reverted");
      // Revert
      setData({
        ...data,
        synced: data.synced.map((l, i) =>
          i === idx ? { ...l, text: original } : l,
        ),
      });
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

  // Auto-scroll the active line into view — but never while editing, since
  // scrolling under an open input is jarring. In performance mode we use
  // instant scroll instead of smooth to avoid the per-frame layout work.
  const perfMode = usePlayerStore((s) => s.performanceMode);
  useEffect(() => {
    if (editingIdx !== null) return;
    if (activeIndex < 0 || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLDivElement>(
      `[data-line-idx="${activeIndex}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: perfMode ? "auto" : "smooth", block: "center" });
    }
  }, [activeIndex, editingIdx, perfMode]);

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

  if (transcribing || data?.autoTranscribing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-zinc-400">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <span>
          {data?.autoTranscribing ? "Auto-transcribing with Whisper…" : "Transcribing with Whisper…"}
        </span>
        <span className="text-xs text-zinc-600">
          {data?.autoTranscribing
            ? "No LRCLIB match — Whisper is taking it from here. Usually 20-60s."
            : "This usually takes 20–60s"}
        </span>
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
          {data.synced.map((line, i) => {
            if (editingIdx === i) {
              return (
                <div
                  key={`edit-${i}-${line.time}`}
                  data-line-idx={i}
                  className="block w-full rounded px-2 py-1.5"
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={() => void saveEdit()}
                    className="w-full rounded border border-emerald-500/60 bg-zinc-900/80 px-2 py-1.5 text-base text-zinc-100 outline-none focus:border-emerald-500"
                  />
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500">
                    <span>Enter to save · Esc to cancel</span>
                    <span className="tabular-nums">{formatLrcTime(line.time)}</span>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={`${i}-${line.time}`}
                type="button"
                data-line-idx={i}
                onClick={() => jumpTo(i)}
                onContextMenu={(e) => onContextMenu(e, i)}
                onDoubleClick={() => beginEdit(i)}
                title="Right-click or double-click to edit"
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
            );
          })}
          {error && <p className="px-2 py-2 text-xs text-red-400">{error}</p>}
        </div>

        {contextMenu && (
          <LyricsContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onEdit={() => beginEdit(contextMenu.idx)}
            onClose={() => setContextMenu(null)}
          />
        )}
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

function LyricsContextMenu({
  x,
  y,
  onEdit,
  onClose,
}: {
  x: number;
  y: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  // Clamp into the viewport so the menu doesn't open off-screen when the
  // user right-clicks near an edge.
  const left = Math.min(x, window.innerWidth - 140);
  const top = Math.min(y, window.innerHeight - 80);
  return (
    <div
      data-lyrics-context-menu
      style={{ left, top }}
      className="fixed z-[60] w-32 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl"
    >
      <button
        type="button"
        onClick={() => {
          onEdit();
          onClose();
        }}
        className="block w-full px-3 py-1.5 text-left text-zinc-200 transition hover:bg-zinc-800"
      >
        Edit line
      </button>
    </div>
  );
}
