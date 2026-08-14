"use client";

import { useSyncExternalStore } from "react";

// Never changes after mount, so there is nothing to subscribe to.
function subscribe() {
  return () => {};
}

/**
 * False while rendering on the server and during hydration, true afterwards.
 *
 * The reason this exists rather than `typeof window !== "undefined"`: that
 * check is evaluated during the hydration render too, where it is already
 * true — so the client renders different HTML than the server sent and React
 * throws away the whole tree and rebuilds it. `useSyncExternalStore` is the
 * supported way to say "the server saw one thing, the client sees another",
 * and it re-renders once, quietly, after hydration completes.
 *
 * Use it to gate anything read from localStorage, matchMedia, or navigator.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
