"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontalIcon, ShareIosIcon, WaveIcon } from "@/components/icons";
import {
  detectShouldShowInstallHint,
  markInstallHintDismissed,
  shareMenuLocation,
} from "@/lib/mobile";
import { useIsHydrated } from "@/hooks/use-hydrated";

/** Let the first paint settle before interrupting it. */
const APPEAR_DELAY_MS = 2000;

/**
 * One-time nudge to add Kyowave to the iOS home screen.
 *
 * iOS never fires `beforeinstallprompt` — there is no way to trigger the
 * install from script, so the only thing we can do is point at the Share
 * button and say which item to tap.
 *
 * Deliberately narrow: iOS only, not already installed, not dismissed before.
 * The detection runs in an effect rather than during render because it reads
 * `navigator` and `localStorage`, neither of which exists on the server.
 *
 * Worth knowing why this is worth 40 lines: installing changes the icon iOS
 * shows in the Dynamic Island and on the lock screen while music plays — from
 * Safari's compass to the Kyowave mark. That is the real payoff, not the tidier
 * home screen.
 */
export function InstallHint({ suppressed = false }: { suppressed?: boolean }) {
  const [show, setShow] = useState(false);
  const hydrated = useIsHydrated();

  // Where Share lives differs by iOS version, and directions to a button that
  // isn't on screen are worse than no directions at all. Derived rather than
  // stored: it cannot change during a session, and reading navigator behind
  // the hydration gate keeps it out of an effect.
  const viaOverflow =
    !hydrated ||
    shareMenuLocation(navigator as unknown as { userAgent: string; maxTouchPoints: number }) ===
      "overflow";

  useEffect(() => {
    if (!detectShouldShowInstallHint()) return;
    const t = setTimeout(() => setShow(true), APPEAR_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    markInstallHintDismissed();
    setShow(false);
  }

  // Never stack on top of another dialog. On a first visit the patch notes and
  // this hint both want the screen, and two modals at once reads as a mess —
  // the hint waits its turn rather than competing. It is not dismissed by
  // waiting, so it appears as soon as the other one closes.
  if (!show || suppressed || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex justify-center px-3 pb-3"
      role="dialog"
      aria-label="Add Kyowave to your home screen"
    >
      <div className="kw-safe-bottom w-full max-w-sm overflow-hidden rounded-2xl border border-sky-500/40 bg-zinc-900 shadow-[0_0_40px_-8px_rgba(14,165,233,0.5),0_20px_50px_-16px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5 border-b border-zinc-800 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
            <WaveIcon size={15} />
          </span>
          <h2 className="text-sm font-bold text-zinc-100">Put Kyowave on your home screen</h2>
        </div>

        <ol className="space-y-2 px-4 py-3.5 text-sm text-zinc-300">
          {viaOverflow ? (
            <>
              <Step n="1">
                Tap
                <span className="mx-1 inline-flex translate-y-[2px] text-sky-400">
                  <MoreHorizontalIcon size={15} />
                </span>
                below
              </Step>
              <Step n="2">
                Then
                <span className="mx-1 inline-flex translate-y-[2px] text-sky-400">
                  <ShareIosIcon size={15} />
                </span>
                Share
              </Step>
              <Step n="3">Add to Home Screen</Step>
            </>
          ) : (
            <>
              <Step n="1">
                Tap
                <span className="mx-1 inline-flex translate-y-[2px] text-sky-400">
                  <ShareIosIcon size={15} />
                </span>
                Share
              </Step>
              <Step n="2">Add to Home Screen</Step>
            </>
          )}
        </ol>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
          <p className="text-[11px] text-zinc-500">Opens full screen. No address bar.</p>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-bold text-zinc-950 transition hover:bg-white"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400">
        {n}
      </span>
      <span className="flex items-center">{children}</span>
    </li>
  );
}
