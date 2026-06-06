"use client";

import { useEffect, useState } from "react";
import { useDownloadStore } from "@/stores/download-store";

// Floating toast — bottom-right, above the player bar. Shows while a YT
// download job is active in the store. Background download survives
// navigation; this just keeps the user informed.

const FAKE_PROGRESS_DURATION_MS = 60_000; // typical 30-150s download — slower curve so 95% feels real

export function DownloadIndicator() {
  const active = useDownloadStore((s) => s.active);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!active) {
      setPct(0);
      return;
    }
    if (active.error) return; // freeze progress when failed
    // If the poller has handed us a real progress reading, just show that —
    // skip the fake animation entirely. Otherwise (the first beat before
    // yt-dlp emits, or any stale fallback), animate up toward 95%.
    if (typeof active.progressPct === "number") {
      setPct(active.progressPct);
      return;
    }
    let raf = 0;
    const t0 = active.startedAt;
    const tick = () => {
      const elapsed = Date.now() - t0;
      const linear = Math.min(1, elapsed / FAKE_PROGRESS_DURATION_MS);
      const eased = 1 - Math.pow(1 - linear, 2);
      setPct(Math.min(95, Math.round(eased * 95)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Auto-dismiss the error toast after a moment so the UI doesn't lock.
  useEffect(() => {
    if (!active?.error) return;
    const h = setTimeout(() => useDownloadStore.getState().finish(), 6000);
    return () => clearTimeout(h);
  }, [active?.error]);

  if (!active) return null;
  const failed = !!active.error;

  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
      <div
        className={
          "pointer-events-auto overflow-hidden rounded-xl border bg-zinc-900/95 shadow-2xl backdrop-blur " +
          (failed ? "border-red-500/50" : "border-zinc-800")
        }
      >
        <div className="flex items-center gap-3 p-3">
          {/* spinner (or warning when failed) */}
          <div className="relative h-9 w-9 shrink-0">
            {failed ? (
              <div className="flex h-full w-full items-center justify-center rounded-full bg-red-500/20 text-red-400">
                !
              </div>
            ) : (
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
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={
                "truncate text-[11px] font-semibold uppercase tracking-wider " +
                (failed ? "text-red-400" : "text-emerald-400")
              }
            >
              {failed ? "Download failed" : "Downloading"}
            </div>
            <div className="truncate text-sm font-medium text-zinc-100">{active.title}</div>
            <div className="truncate text-xs text-zinc-500">
              {failed ? active.error : active.artist}
            </div>
          </div>
          {!failed && (
            <div className="shrink-0 text-right text-xs text-zinc-400 tabular-nums">{pct}%</div>
          )}
        </div>
        {!failed && (
          <div className="h-1 w-full bg-zinc-800">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
