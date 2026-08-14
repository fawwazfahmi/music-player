"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { BoltIcon } from "@/components/icons";
import { PATCH_NOTES, markSeen, type Change, type Release } from "@/lib/patch-notes";

const KIND_STYLE: Record<Change["kind"], { label: string; cls: string }> = {
  added: { label: "New", cls: "bg-emerald-500/15 text-emerald-300" },
  fixed: { label: "Fixed", cls: "bg-sky-500/15 text-sky-300" },
  changed: { label: "Changed", cls: "bg-amber-500/15 text-amber-300" },
};

/**
 * What's new.
 *
 * `releases` is what to show: the unseen ones on an automatic open, or the
 * full history when opened from Settings. Dismissing marks the current
 * version seen either way, so it won't reappear on the next load.
 *
 * Portalled to document.body for the same reason as the Performance Mode
 * dialog — PlayerBar's backdrop-blur creates a containing block, and a fixed
 * overlay rendered under it centres on the player bar instead of the page.
 */
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
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-emerald-500/40 bg-zinc-900 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_60px_-10px_rgba(16,185,129,0.55),0_24px_60px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-800 px-5 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <BoltIcon size={15} />
          </span>
          <h2 className="text-sm font-bold text-zinc-100">What&apos;s new</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {releases.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              You&apos;re up to date.
            </p>
          ) : (
            releases.map((r) => (
              <section key={r.version} className="mb-5 last:mb-0">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">{r.title}</h3>
                  <span className="text-[11px] text-zinc-600">{r.date}</span>
                </div>
                <ul className="space-y-2">
                  {r.changes.map((c, i) => {
                    const style = KIND_STYLE[c.kind];
                    return (
                      <li key={i} className="flex gap-2.5">
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.cls}`}
                        >
                          {style.label}
                        </span>
                        <span className="text-xs leading-snug text-zinc-300">{c.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={dismiss}
            autoFocus
            className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
