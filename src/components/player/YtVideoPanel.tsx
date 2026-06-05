"use client";

import { useEffect, useRef } from "react";
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

export function YtVideoPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const track = queue[currentIndex] ?? null;
  const ytVideoId = (track as { ytVideoId?: string | null } | null)?.ytVideoId;

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const currentVideoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ytVideoId || !containerRef.current) return;

    let cancelled = false;
    void loadIframeAPI().then(() => {
      if (cancelled || !containerRef.current) return;

      const Ctor = (window.YT as unknown as { Player: YT.PlayerConstructor }).Player;

      if (playerRef.current && currentVideoRef.current === ytVideoId) return;

      if (playerRef.current && currentVideoRef.current !== ytVideoId) {
        try {
          playerRef.current.cueVideoById({ videoId: ytVideoId, startSeconds: position });
          currentVideoRef.current = ytVideoId;
          return;
        } catch {
          /* fall through to recreate */
        }
      }

      // Safely clear existing children, then mount a fresh div
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
      const mountEl = document.createElement("div");
      containerRef.current.appendChild(mountEl);

      readyRef.current = false;
      playerRef.current = new Ctor(mountEl, {
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
            e.target.mute();
            try {
              e.target.seekTo(position, true);
            } catch {}
            readyRef.current = true;
          },
        },
      });
      currentVideoRef.current = ytVideoId;
    });

    return () => {
      cancelled = true;
    };
  }, [ytVideoId]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    try {
      if (isPlaying) playerRef.current.playVideo();
      else playerRef.current.pauseVideo();
    } catch {}
  }, [isPlaying]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    try {
      const ytTime = playerRef.current.getCurrentTime();
      if (Math.abs(ytTime - position) > DRIFT_THRESHOLD) {
        playerRef.current.seekTo(position, true);
      }
    } catch {}
  }, [position]);

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
      <div ref={containerRef} className="absolute inset-0 [&>div]:h-full [&>iframe]:h-full [&>iframe]:w-full" />
      <div className="absolute inset-0" aria-hidden="true" />
    </div>
  );
}
