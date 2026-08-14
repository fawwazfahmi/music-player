"use client";

import { useCallback, useEffect, useState } from "react";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";

/** Broadcast so every heart showing the same track repaints together. */
export const FAV_CHANGED_EVENT = "ipod-fav-changed";

/**
 * Favourite state for one track, kept in sync across every component showing it.
 *
 * Hearts appear in three places at once on a phone — the row, the mini player
 * and the open sheet — so toggling in one has to move the others. A window
 * event is the whole mechanism; there is no shared store for it.
 */
export function useFavorite(trackId: string | null | undefined) {
  // The answer is stored with the track it belongs to, so switching tracks
  // reads as "unknown → false" without an effect having to reset it. Storing a
  // bare boolean would show the previous track's heart until the fetch landed.
  const [resolved, setResolved] = useState<{ id: string; fav: boolean } | null>(null);
  const fav = resolved !== null && resolved.id === trackId && resolved.fav;

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    void isFavorited("TRACK", trackId).then((f) => {
      if (!cancelled) setResolved({ id: trackId, fav: f });
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    if (!trackId) return;
    function handler() {
      void isFavorited("TRACK", trackId!).then((f) =>
        setResolved({ id: trackId!, fav: f }),
      );
    }
    window.addEventListener(FAV_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FAV_CHANGED_EVENT, handler);
  }, [trackId]);

  const toggle = useCallback(async () => {
    if (!trackId) return;
    const next = await toggleFavorite("TRACK", trackId);
    setResolved({ id: trackId, fav: next });
    window.dispatchEvent(new CustomEvent(FAV_CHANGED_EVENT));
  }, [trackId]);

  return { fav, toggle };
}
