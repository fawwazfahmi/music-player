import { create } from "zustand";

export interface QueueTrack {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtPath?: string | null;
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
  currentTrack: () => QueueTrack | null;
  setQueue: (queue: QueueTrack[], startIndex?: number) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  setPosition: (p: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: "off",
  volume: 1,
  position: 0,
  currentTrack: () => {
    const s = get();
    return s.queue[s.currentIndex] ?? null;
  },
  setQueue: (queue, startIndex = 0) =>
    set({ queue, currentIndex: queue.length ? Math.min(startIndex, queue.length - 1) : -1, isPlaying: queue.length > 0, position: 0 }),
  next: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      if (s.currentIndex < s.queue.length - 1) return { currentIndex: s.currentIndex + 1, position: 0 };
      if (s.repeat === "all") return { currentIndex: 0, position: 0 };
      return { isPlaying: false };
    }),
  prev: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      if (s.position > 3) return { position: 0 };
      if (s.currentIndex > 0) return { currentIndex: s.currentIndex - 1, position: 0 };
      if (s.repeat === "all") return { currentIndex: s.queue.length - 1, position: 0 };
      return { position: 0 };
    }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setShuffle: (v) => set({ shuffle: v }),
  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
  setPosition: (p) => set({ position: Math.max(0, p) }),
}));
