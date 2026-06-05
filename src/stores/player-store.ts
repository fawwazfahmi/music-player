import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface QueueTrack {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtHash?: string | null;
  ytVideoId?: string | null;
}

export type RepeatMode = "off" | "one" | "all";

interface PlayerState {
  queue: QueueTrack[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  position: number;
  // True while we're waiting for the YT iframe to load before starting playback.
  // Transient; not persisted.
  videoLoading: boolean;
  // Increments whenever playback is intentionally restarted or moved to a new
  // queue item, even if the YouTube video id is the same.
  playbackKey: number;
  currentTrack: () => QueueTrack | null;
  setQueue: (queue: QueueTrack[], startIndex?: number) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  setPosition: (p: number) => void;
  setVideoLoading: (v: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      shuffle: false,
      repeat: "off",
      volume: 1,
      position: 0,
      videoLoading: false,
      playbackKey: 0,
      currentTrack: () => {
        const s = get();
        return s.queue[s.currentIndex] ?? null;
      },
      setQueue: (queue, startIndex = 0) => {
        const next = queue[Math.min(startIndex, queue.length - 1)];
        // If the track has a YT video, gate playback on the iframe being ready.
        // Without a video, no gate needed.
        const hasVideo = !!next?.ytVideoId;
        set({
          queue,
          currentIndex: queue.length ? Math.min(startIndex, queue.length - 1) : -1,
          isPlaying: queue.length > 0,
          videoLoading: hasVideo,
          playbackKey: get().playbackKey + 1,
          position: 0,
        });
      },
      next: () =>
        set((s) => {
          if (s.queue.length === 0) return s;
          if (s.currentIndex < s.queue.length - 1) {
            const next = s.queue[s.currentIndex + 1];
            return {
              currentIndex: s.currentIndex + 1,
              position: 0,
              videoLoading: !!next?.ytVideoId,
              playbackKey: s.playbackKey + 1,
            };
          }
          if (s.repeat === "all") {
            const next = s.queue[0];
            return {
              currentIndex: 0,
              position: 0,
              videoLoading: !!next?.ytVideoId,
              playbackKey: s.playbackKey + 1,
            };
          }
          return { isPlaying: false };
        }),
      prev: () =>
        set((s) => {
          if (s.queue.length === 0) return s;
          if (s.position > 3) return { position: 0 };
          if (s.currentIndex > 0) {
            const next = s.queue[s.currentIndex - 1];
            return {
              currentIndex: s.currentIndex - 1,
              position: 0,
              videoLoading: !!next?.ytVideoId,
              playbackKey: s.playbackKey + 1,
            };
          }
          if (s.repeat === "all") {
            const next = s.queue[s.queue.length - 1];
            return {
              currentIndex: s.queue.length - 1,
              position: 0,
              videoLoading: !!next?.ytVideoId,
              playbackKey: s.playbackKey + 1,
            };
          }
          return { position: 0 };
        }),
      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
      setShuffle: (v) => set({ shuffle: v }),
      cycleRepeat: () =>
        set((s) => ({
          repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
        })),
      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
      setPosition: (p) => set({ position: Math.max(0, p) }),
      setVideoLoading: (v) => set({ videoLoading: v }),
    }),
    {
      // Per-device persistence: localStorage on the user's own machine.
      // Only saves preferences (volume, shuffle, repeat) — never queue/playback state.
      name: "music-universe-player",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            }
          : localStorage,
      ),
      partialize: (state) => ({
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    },
  ),
);
