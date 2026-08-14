"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  PATCH_NOTES,
  markSeen,
  waveformBars,
  type Change,
  type Release,
} from "@/lib/patch-notes";

/**
 * What's new.
 *
 * Presented as a release with a tracklist, because that is what it is: an
 * ordered set of items shipped together. The numbering is real information —
 * rows are ordered by significance, lead single first — rather than decoration.
 *
 * Visual identity is deliberately NOT the Performance Mode dialog's. Emerald
 * means playback in this app and the bolt means Performance Mode; wearing
 * either made this dialog read as a mode switch. It gets violet, used nowhere
 * else, and a waveform strip keyed to the version — the app is called Kyowave.
 *
 * Portalled to document.body: PlayerBar's backdrop-blur creates a containing
 * block, so a fixed overlay rendered beneath it centres on the player bar.
 */

const KIND_LABEL: Record<Change["kind"], { text: string; cls: string }> = {
  added: { text: "new", cls: "text-violet-300" },
  fixed: { text: "fixed", cls: "text-sky-300/80" },
  changed: { text: "changed", cls: "text-zinc-400" },
};

export function PatchNotesDialog({
  open,
  releases = PATCH_NOTES,
  onClose,
}: {
  open: boolean;
  releases?: Release[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  function dismiss() {
    markSeen();
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="What's new in Kyowave"
    >
      <div
        className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.95)]"
        onClick={(e) => e.stopPropagation()}
      >
        {releases.length > 0 && <Waveform seed={releases[0]!.version} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {releases.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-zinc-500">
              You&apos;re up to date.
            </p>
          ) : (
            releases.map((r) => <ReleaseBlock key={r.version} release={r} />)
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            Kyowave
          </span>
          <button
            type="button"
            onClick={dismiss}
            autoFocus
            className="rounded-lg bg-violet-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The signature element: a strip of bars whose heights come from the version
 * string, so a release always looks like itself.
 */
function Waveform({ seed }: { seed: string }) {
  const bars = waveformBars(seed);
  return (
    <div
      aria-hidden
      className="flex h-10 shrink-0 items-end gap-[3px] border-b border-zinc-800 bg-zinc-950/60 px-6 pb-2 pt-3"
    >
      {bars.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px] bg-gradient-to-t from-violet-500/30 to-violet-300/80"
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </div>
  );
}

function ReleaseBlock({ release }: { release: Release }) {
  return (
    <section className="border-b border-zinc-800/60 px-6 py-5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-violet-300/70">
          Release {release.version}
        </span>
        <span className="font-mono text-[10px] text-zinc-600">{release.date}</span>
      </div>
      <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">
        {release.title}
      </h3>

      <ol className="mt-4 space-y-2.5">
        {release.changes.map((c, i) => {
          const kind = KIND_LABEL[c.kind];
          return (
            <li
              key={i}
              style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              className="grid grid-cols-[1.5rem_4rem_minmax(0,1fr)] items-baseline gap-3 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards duration-300 motion-reduce:animate-none"
            >
              <span className="font-mono text-[11px] tabular-nums text-zinc-600">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${kind.cls}`}>
                {kind.text}
              </span>
              <span className="text-[13px] leading-snug text-zinc-300">{c.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
