"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MOBILE_MAX_WIDTH } from "@/lib/mobile";

/**
 * Subscribe to a media query.
 *
 * `useSyncExternalStore` rather than `useState` + effect: it reads the real
 * value during the same render that hydration happens in, so there is no extra
 * commit and no `set-state-in-effect` lint escape. The server snapshot is
 * always `false`, which is why layout swapping is done in CSS and this hook is
 * only used for *behaviour* — see the comment in AppShell.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Viewport narrower than Tailwind's `md`. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
}

/**
 * Coarse pointer — i.e. hover does not exist here.
 *
 * Separate from `useIsMobile` on purpose: an iPad in landscape is wider than
 * the mobile breakpoint but still has no hover, and that is exactly the
 * configuration where a hover-only control becomes silently unreachable.
 */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
