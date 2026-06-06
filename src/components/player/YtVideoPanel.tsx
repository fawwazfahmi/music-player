"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useIpodStore } from "@/stores/ipod-store";

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  mute(): void;
  unMute(): void;
  setSize(width: number | string, height: number | string): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData?(): { video_id?: string };
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
  getIframe?(): HTMLIFrameElement | null;
}

interface YtPlayerOptions {
  videoId?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YtPlayer }) => void;
    onStateChange?: (e: { target: YtPlayer; data: number }) => void;
  };
}

interface YtPlayerConstructor {
  new (elementId: string | HTMLElement, opts: YtPlayerOptions): YtPlayer;
}

declare global {
  interface Window {
    YT?: { Player: YtPlayerConstructor };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
export function loadIframeAPI(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && (window.YT as unknown as { Player?: YtPlayerConstructor }).Player) {
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

function isPlayerAlive(p: YtPlayer | null): boolean {
  if (!p) return false;
  try {
    const iframe = p.getIframe?.();
    return !!iframe && document.body.contains(iframe);
  } catch {
    return false;
  }
}

// YT.PlayerState constants
const YT_UNSTARTED = -1;
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_CUED = 5;

export function YtVideoPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const playbackKey = usePlayerStore((s) => s.playbackKey);
  const track = queue[currentIndex] ?? null;
  const ytVideoId = (track as { ytVideoId?: string | null } | null)?.ytVideoId;

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const currentVideoRef = useRef<string | null>(null);
  const positionRef = useRef(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // When the iframe is moved between slots (small ↔ big), just resize the
  // player — don't reload. The DOM node stays alive across appendChild.
  useEffect(() => {
    function handleSlotMoved() {
      const p = playerRef.current;
      if (!p || !isPlayerAlive(p)) return;
      try {
        const iframe = p.getIframe?.();
        if (!iframe) return;
        const parent = iframe.parentElement?.parentElement; // .container → .slot
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          p.setSize(Math.round(rect.width), Math.round(rect.height));
        }
      } catch {}
    }
    window.addEventListener("music-video-slot-moved", handleSlotMoved);
    return () => window.removeEventListener("music-video-slot-moved", handleSlotMoved);
  }, []);

  // Create / swap / destroy the YT player when track changes.
  useEffect(() => {
    if (!ytVideoId || !containerRef.current) return;
    const myContainer = containerRef.current;

    let cancelled = false;
    let createdPlayer: YtPlayer | null = null;
    let releaseTimer: number | null = null;

    void loadIframeAPI().then(() => {
      if (cancelled) return;
      if (!document.body.contains(myContainer)) return;

      const Ctor = (window.YT as unknown as { Player: YtPlayerConstructor }).Player;

      // Schedule a safety-net release of videoLoading in case YT doesn't
      // fire a fresh PLAYING event (e.g. same-video replay where state was
      // already PLAYING and stays PLAYING).
      function scheduleRelease() {
        if (releaseTimer !== null) window.clearTimeout(releaseTimer);
        releaseTimer = window.setTimeout(() => {
          const p = playerRef.current;
          if (p && isPlayerAlive(p)) {
            try {
              const state = p.getPlayerState();
              if (state === YT_PLAYING || state === YT_BUFFERING || state === YT_PAUSED) {
                usePlayerStore.getState().setVideoLoading(false);
              }
            } catch {}
          }
          // Final fallback: always release after a short delay so audio doesn't
          // hang on stuck "Loading video…"
          usePlayerStore.getState().setVideoLoading(false);
        }, 1200);
      }

      // ──── Same video, live player → seek + replay (no reload) ─────────────
      if (
        playerRef.current &&
        isPlayerAlive(playerRef.current) &&
        currentVideoRef.current === ytVideoId
      ) {
        try {
          playerRef.current.mute();
          playerRef.current.seekTo(positionRef.current, true);
          if (usePlayerStore.getState().isPlaying) {
            playerRef.current.playVideo();
          }
          scheduleRelease();
          return;
        } catch {
          /* fall through to reload */
        }
      }

      // ──── Different video, live player → loadVideoById (reload content) ───
      if (playerRef.current && isPlayerAlive(playerRef.current)) {
        try {
          readyRef.current = false;
          setReady(false);
          playerRef.current.mute();
          playerRef.current.loadVideoById(ytVideoId, positionRef.current);
          if (usePlayerStore.getState().isPlaying) {
            playerRef.current.playVideo();
          }
          currentVideoRef.current = ytVideoId;
          scheduleRelease();
          return;
        } catch {
          /* fall through to recreate */
        }
      }

      // ──── Fresh create ─────────────────────────────────────────────────────
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
      readyRef.current = false;
      setReady(false);
      while (myContainer.firstChild) {
        myContainer.removeChild(myContainer.firstChild);
      }
      const mountEl = document.createElement("div");
      myContainer.appendChild(mountEl);

      // Use the current container's real pixel size so YT renders at the
      // correct resolution from the start (no black-until-resize bug).
      const rect = myContainer.getBoundingClientRect();
      const initialW = Math.max(1, Math.round(rect.width || 640));
      const initialH = Math.max(1, Math.round(rect.height || 360));

      createdPlayer = new Ctor(mountEl, {
        videoId: ytVideoId,
        width: initialW,
        height: initialH,
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
            if (playerRef.current !== createdPlayer) return; // stale
            const { isPlaying: playing } = usePlayerStore.getState();
            try {
              e.target.mute();
              e.target.seekTo(positionRef.current, true);
              if (playing) {
                e.target.playVideo();
              } else {
                usePlayerStore.getState().setVideoLoading(false);
              }
            } catch {
              usePlayerStore.getState().setVideoLoading(false);
            }
            readyRef.current = true;
            setReady(true);
          },
          onStateChange: (e) => {
            if (playerRef.current !== createdPlayer) return;
            // Release the audio gate when YT is genuinely rendering frames.
            // BUFFERING also indicates YT has started fetching data — release
            // a hair earlier for snappier perceived sync.
            if (e.data === YT_PLAYING || e.data === YT_BUFFERING) {
              usePlayerStore.getState().setVideoLoading(false);
              if (!readyRef.current) {
                readyRef.current = true;
                setReady(true);
              }
            }
            // Edge case: YT cued the video but never auto-played (rare). Release
            // anyway so audio can start.
            if (e.data === YT_CUED || e.data === YT_UNSTARTED || e.data === YT_ENDED) {
              usePlayerStore.getState().setVideoLoading(false);
            }
          },
        },
      });
      playerRef.current = createdPlayer;
      currentVideoRef.current = ytVideoId;
    });

    // Hard safety: if YT iframe never loads (network block, etc.), release
    // the audio gate after 8 s so playback isn't blocked forever.
    const hardTimeout = window.setTimeout(() => {
      usePlayerStore.getState().setVideoLoading(false);
    }, 8000);

    return () => {
      cancelled = true;
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
      window.clearTimeout(hardTimeout);
    };
  }, [ytVideoId, playbackKey]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
        readyRef.current = false;
        currentVideoRef.current = null;
      }
    };
  }, []);

  // Play / pause sync
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !isPlayerAlive(p)) return;
    try {
      if (isPlaying) p.playVideo();
      else p.pauseVideo();
    } catch {}
  }, [isPlaying, ready]);

  // Position sync
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
        className="absolute inset-0 [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:!max-w-full [&_iframe]:object-cover"
      />
      {/* Expand button — visible only when NOT already in fullscreen.
          Lives inside the VideoStage container so it naturally paints ABOVE
          the iframe (same stacking context). pointer-events:auto so it
          captures clicks, even though the container itself has pe:none. */}
      <ExpandOverlay />
    </div>
  );
}

function ExpandOverlay() {
  const current = useIpodStore((s) => s.current());
  const push = useIpodStore((s) => s.push);
  if (current.name === "nowPlayingFull") return null;
  return (
    <button
      type="button"
      onClick={() => push({ name: "nowPlayingFull" })}
      title="Expand to fullscreen"
      aria-label="Expand to fullscreen"
      className="group absolute inset-0 flex items-start justify-end p-2"
      style={{ pointerEvents: "auto" }}
    >
      <span className="rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-zinc-200 opacity-0 backdrop-blur transition group-hover:opacity-100">
        Expand ⛶
      </span>
    </button>
  );
}
