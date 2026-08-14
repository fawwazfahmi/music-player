"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { BoltIcon } from "@/components/icons";

/**
 * Shown when switching Performance Mode ON, so it's clear what disappears.
 *
 * Only on the way in. Switching back to normal restores everything and needs
 * no explanation, so it just happens.
 *
 * The list below describes what the mode actually does. It does NOT hide the
 * lyrics panel — Performance Mode only drops the smooth-scroll animation on
 * the active lyric line. Saying otherwise here would be the fastest way to
 * make this dialog a lie.
 *
 * Rendered through a portal to document.body. PlayerBar's root carries
 * `backdrop-blur`, and backdrop-filter creates a containing block for fixed
 * descendants — so without the portal this overlay is positioned against the
 * 80px player bar instead of the viewport, and lands nowhere near centre.
 */
export function PerformanceModeDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // No mounted-state flag needed: `open` only flips true from a click, so this
  // never renders during SSR.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Turn on Performance Mode"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-emerald-500/40 bg-zinc-900 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_60px_-10px_rgba(16,185,129,0.55),0_24px_60px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-800 px-5 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <BoltIcon size={15} />
          </span>
          <h2 className="text-sm font-bold text-zinc-100">Turn on Performance Mode</h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-zinc-400">
            For running kyote in a background tab while you&apos;re gaming. It turns off:
          </p>
          <ul className="mt-3 space-y-2">
            <Item
              title="The YouTube video"
              detail="The iframe is removed entirely — album art shows instead. This is the big one: video keeps decoding on the GPU even muted."
            />
            <Item
              title="Smooth lyric scrolling"
              detail="Lyrics still work, they just jump to the active line instead of animating to it."
            />
            <Item title="Decorative animations" detail="Transitions and other UI eye candy." />
          </ul>
          <p className="mt-3 text-[11px] text-zinc-500">
            Audio, lyrics, and the queue are untouched. Turning it back off restores
            everything immediately.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Turn on
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Item({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70" />
      <div>
        <div className="text-xs font-medium text-zinc-200">{title}</div>
        <div className="text-[11px] leading-snug text-zinc-500">{detail}</div>
      </div>
    </li>
  );
}
