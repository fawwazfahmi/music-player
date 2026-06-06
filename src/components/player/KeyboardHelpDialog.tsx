"use client";

import { SHORTCUT_HELP } from "@/hooks/use-keyboard-shortcuts";

export function KeyboardHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Esc
          </button>
        </div>
        <ul className="divide-y divide-zinc-800/60">
          {SHORTCUT_HELP.map((s) => (
            <li
              key={s.combo}
              className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm"
            >
              <span className="text-zinc-300">{s.desc}</span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-200">
                {s.combo}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="border-t border-zinc-800 px-5 py-2 text-[11px] text-zinc-600">
          Shortcuts are disabled while typing in a text field.
        </p>
      </div>
    </div>
  );
}
