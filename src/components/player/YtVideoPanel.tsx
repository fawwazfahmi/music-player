"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";

declare global {
  interface Window {
    YT?: { Player: YT.PlayerConstructor };
    onYouTubeIframeAPIReady?: () => void;
  }
  namespace YT {
    interface Player {
      playVideo(): void;
      pauseVideo(): void;
      seekTo(seconds: number, allowSeekAhead?: boolean): void;
      mute(): void;
      unMute(): void;
      getCurrentTime(): number;
      getPlayerState(): number;
      loadVideoById(videoId: string, startSeconds?: number): void;
      cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
      destroy(): void;
      getIframe?(): HTMLIFrameElement | null;
    }
    interface PlayerOptions {
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: Player }) => void;
        onStateChange?: (e: { target: Player; data: number }) => void;
      };
    }
    interface PlayerConstructor {
      new (elementId: string | HTMLElement, opts: PlayerOptions): Player;
    }
  }
}

let apiPromise: Promise<void> | null = null;
function loadIframeAPI(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && (window.YT as unknown as { Player?: YT.PlayerConstructor }).Player) {
    return Promise.resolve();
  }
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiPromise;
}

const DRIFT_THRESHOLD = 1.0;

// Returns true if the YT player object is still "live" — has an iframe in the DOM.
function isPlayerAlive(p: YT.Player | null): boolean {
  if (!p) return false;
  try {
    const iframe = p.getIframe?.();
    return !!iframe && document.body.contains(iframe);
  } catch {
    return false;
  }
}

export function YtVideoPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const track = queue[currentIndex] ?? null;
  const ytVideoId = (track as { ytVideoId?: string | null } | null)?.ytVideoId;

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const [ready, setReady] = useState(false);
  const currentVideoRef = useRef<string | null>(null);

  // Mount/teardown the player
  useEffect(() => {
    if (!ytVideoId || !containerRef.current) return;
    const myContainer = containerRef.current;

    let cancelled = false;
    let createdPlayer: YT.Player | null = null;

    void loadIframeAPI().then(() => {
      if (cancelled) return;
      if (!document.body.contains(myContainer)) return;

      const Ctor = (window.YT as unknown as { Player: YT.PlayerConstructor }).Player;

      // Already showing this video on a live player
      if (
        playerRef.current &&
        isPlayerAlive(playerRef.current) &&
        currentVideoRef.current === ytVideoId
      ) {
        return;
      }

      // Different video, live player → swap via cueVideoById
      if (
        playerRef.current &&
        isPlayerAlive(playerRef.current) &&
        currentVideoRef.current !== ytVideoId
      ) {
        try {
          setReady(false);
          playerRef.current.cueVideoById({ videoId: ytVideoId, startSeconds: position });
          currentVideoRef.current = ytVideoId;
          // ready will flip back true via a fresh onStateChange BUFFERING/PLAYING event
          // — we capture this via the onStateChange handler below
          return;
        } catch {
          /* fall through to recreate */
        }
      }

      // Destroy stale player + recreate
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
        setReady(false);
      }
      while (myContainer.firstChild) {
        myContainer.removeChild(myContainer.firstChild);
      }
      const mountEl = document.createElement("div");
      myContainer.appendChild(mountEl);

      createdPlayer = new Ctor(mountEl, {
        videoId: ytVideoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (e) => {
            if (playerRef.current !== createdPlayer) return; // stale (strict-mode remount)
            try {
              e.target.mute();
              e.target.seekTo(position, true);
            } catch {}
            setReady(true);
          },
          onStateChange: () => {
            if (playerRef.current !== createdPlayer) return;
            if (!ready) setReady(true);
          },
        },
      });
      playerRef.current = createdPlayer;
      currentVideoRef.current = ytVideoId;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytVideoId]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
        currentVideoRef.current = null;
      }
    };
  }, []);

  // Play/pause sync — guarded on ready + alive
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !isPlayerAlive(p)) return;
    try {
      if (isPlaying) p.playVideo();
      else p.pauseVideo();
    } catch {}
  }, [isPlaying, ready]);

  // Position sync — debounced via drift threshold
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !isPlayerAlive(p)) return;
    try {
      const ytTime = p.getCurrentTime();
      if (Math.abs(ytTime - position) > DRIFT_THRESHOLD) {
        p.seekTo(position, true);
      }
    } catch {}
  }, [position, ready]);

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Nothing playing
      </div>
    );
  }

  if (!ytVideoId) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-900">
        {track.coverArtHash ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/art/${track.coverArtHash}`}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
            No video
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0 [&>div]:h-full [&>iframe]:h-full [&>iframe]:w-full"
      />
      <div className="absolute inset-0" aria-hidden="true" />
    </div>
  );
}
