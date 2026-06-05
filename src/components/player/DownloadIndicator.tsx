"use client";

import { useEffect, useState } from "react";
import { useDownloadStore } from "@/stores/download-store";

// Floating toast — bottom-right, above the player bar. Shows while a YT
// download is running. Navigating away from YtPickerPage does NOT cancel
// the download (server action keeps running); this just keeps the user
// informed.

const FAKE_PROGRESS_DURATION_MS = 25_000; // typical 15-30s download

export function DownloadIndicator() {
  const active = useDownloadStore((s) => s.active);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!active) {
      setPct(0);
      return;
    }
    // We don't have real progress from the server (yt-dlp writes progress to
    // stdout but the action awaits the full process). Use a fake bar that
    // asymptotically approaches 95% so the user knows it's working.
    let raf = 0;
    const t0 = active.startedAt;
    const tick = () => {
      const elapsed = Date.now() - t0;
      const linear = Math.min(1, elapsed / FAKE_PROGRESS_DURATION_MS);
      // Ease-out: fast at first, slower as we approach 95%
      const eased = 1 - Math.pow(1 - linear, 2);
      setPct(Math.min(95, Math.round(eased * 95)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3 p-3">
          {/* spinner */}
          <div className="relative h-9 w-9 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full animate-spin text-emerald-500">
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="22 88"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              Downloading
            </div>
            <div className="truncate text-sm font-medium text-zinc-100">{active.title}</div>
            <div className="truncate text-xs text-zinc-500">{active.artist}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-zinc-400 tabular-nums">{pct}%</div>
        </div>
        <div className="h-1 w-full bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
