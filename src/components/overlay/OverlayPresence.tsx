"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/stores/player-store";

// Invisible. Pushes the current now-playing to the server so the public OBS
// overlay (/overlay/now-playing) can mirror it — no listening party needed.
// Re-pushes immediately on track / play-pause change, plus a 4s heartbeat
// that also refreshes position. When nothing is playing it stops pushing and
// the server presence goes stale, so the overlay hides itself.
export function OverlayPresence() {
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const playbackKey = usePlayerStore((s) => s.playbackKey);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    let stopped = false;
    async function push() {
      if (stopped) return;
      const s = usePlayerStore.getState();
      const t = s.queue[s.currentIndex];
      if (!t) return;
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: t.title,
            artist: t.artist,
            coverArtHash: t.coverArtHash ?? null,
            ytVideoId: t.ytVideoId ?? null,
            position: s.position,
            duration: t.duration,
            isPlaying: s.isPlaying,
          }),
          keepalive: true,
        });
      } catch {
        /* network blip — next heartbeat retries */
      }
    }
    void push();
    const iv = setInterval(push, 4000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [currentIndex, playbackKey, isPlaying]);

  return null;
}
