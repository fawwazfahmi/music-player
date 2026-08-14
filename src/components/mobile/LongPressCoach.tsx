"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useIsTouch } from "@/hooks/use-media-query";
import { markCoachSeen, readCoachSeen } from "@/lib/mobile";

/**
 * One-time "hold a song for options" overlay.
 *
 * Long-press is invisible by nature, so it gets told once, in four words. This
 * is layer one of three: the ⋮ that survives the first few menu opens is layer
 * two, and the tip inside the menu is what actually converts a tapper into
 * someone who holds. See `use-menu-prefs`.
 *
 * Shown on the first touch-device visit to any screen that renders song rows.
 * The caller decides where that is; this component only decides whether.
 */
export function LongPressCoach() {
  const isTouch = useIsTouch();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isTouch || readCoachSeen()) return;
    // Let the list paint first — spotlighting a row that isn't there yet
    // points at nothing.
    const t = setTimeout(() => setShow(true), 700);
    return () => clearTimeout(t);
  }, [isTouch]);

  function dismiss() {
    markCoachSeen();
    setShow(false);
  }

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <button
      type="button"
      onClick={dismiss}
      aria-label="Got it"
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-1 bg-black/75 px-8 text-center backdrop-blur-[2px]"
    >
      <span className="text-3xl" aria-hidden>
        ☝︎
      </span>
      <span className="mt-2 text-xl font-extrabold text-zinc-50">Hold for options</span>
      <span className="text-sm text-zinc-400">cover, lyrics, playlists, delete</span>
      <span className="mt-6 rounded-full bg-zinc-100 px-6 py-2 text-sm font-bold text-zinc-950">
        Got it
      </span>
    </button>,
    document.body,
  );
}
