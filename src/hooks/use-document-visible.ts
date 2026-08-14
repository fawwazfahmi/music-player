"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the page is currently on screen.
 *
 * Used to tear the YouTube iframe down when the phone is pocketed. Audio is a
 * plain `<audio>` element and keeps playing regardless — only the video, which
 * nobody can see and which is decoding the whole time, needs to stop.
 *
 * `pagehide` is listened to alongside `visibilitychange` because iOS does not
 * fire `visibilitychange` reliably on screen lock in every version, and a
 * missed hide means the iframe decodes in her pocket until the battery notices.
 */
function subscribe(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("pagehide", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("pagehide", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

export function useDocumentVisible(): boolean {
  const getSnapshot = useCallback(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
