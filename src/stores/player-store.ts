import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Identity-scope the localStorage key so two tabs in the same browser
// running the app as different people (ainul vs fawwaz) keep separate
// volume / shuffle / repeat preferences. Read the mu_name cookie once at
// module load — fall back to a shared "default" key when no cookie is
// present (SSR or pre-login).
function getPersistName(): string {
  if (typeof document === "undefined") return "music-universe-player:ssr";
  const m = /(?:^|;\s*)mu_name=([^;]+)/.exec(document.cookie);
  if (m) {
    const name = decodeURIComponent(m[1]!).toLowerCase();
    return `music-universe-player:${name}`;
  }
  return "music-universe-player:default";
}

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
  /** Append a track to the end of the queue. If the queue is empty, starts
      playing it immediately. */
  addToQueue: (track: QueueTrack) => void;
  /** Append many tracks in one shot — used when adding a YT playlist /
      mix so we do a single state update instead of N back-to-back. */
  addManyToQueue: (tracks: QueueTrack[]) => void;
  /** Insert a track right after the currently playing one. If the queue is
      empty, starts playing immediately. */
  playNext: (track: QueueTrack) => void;
  /** Remove the track at `index` from the queue. Adjusts currentIndex and
      stops playback if the queue becomes empty. */
  removeFromQueue: (index: number) => void;
  /** Jump playback to a specific queue index (used by the Queue tab). */
  jumpToIndex: (index: number) => void;
  /** Move a track from one queue position to another. currentIndex is
      adjusted so the currently-playing track stays correctly pointed at. */
  reorderQueue: (from: number, to: number) => void;
  /** Remove every occurrence of `trackId` from the queue. Used after the row
      is deleted from the database so it can't be played. */
  purgeTrack: (trackId: string) => void;
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
      addToQueue: (track) =>
        set((s) => {
          // Empty queue → treat as setQueue so playback actually starts.
          if (s.queue.length === 0) {
            return {
              queue: [track],
              currentIndex: 0,
              isPlaying: true,
              videoLoading: !!track.ytVideoId,
              playbackKey: s.playbackKey + 1,
              position: 0,
            };
          }
          return { queue: [...s.queue, track] };
        }),
      addManyToQueue: (tracks) =>
        set((s) => {
          if (tracks.length === 0) return s;
          if (s.queue.length === 0) {
            const first = tracks[0]!;
            return {
              queue: tracks,
              currentIndex: 0,
              isPlaying: true,
              videoLoading: !!first.ytVideoId,
              playbackKey: s.playbackKey + 1,
              position: 0,
            };
          }
          return { queue: [...s.queue, ...tracks] };
        }),
      playNext: (track) =>
        set((s) => {
          if (s.queue.length === 0) {
            return {
              queue: [track],
              currentIndex: 0,
              isPlaying: true,
              videoLoading: !!track.ytVideoId,
              playbackKey: s.playbackKey + 1,
              position: 0,
            };
          }
          const insertAt = s.currentIndex + 1;
          const queue = [...s.queue.slice(0, insertAt), track, ...s.queue.slice(insertAt)];
          return { queue };
        }),
      reorderQueue: (from, to) =>
        set((s) => {
          if (
            from === to ||
            from < 0 ||
            to < 0 ||
            from >= s.queue.length ||
            to >= s.queue.length
          ) {
            return s;
          }
          const next = [...s.queue];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved!);
          // Recompute currentIndex so the actively-playing track stays the
          // active one, regardless of how the reorder shuffled its position.
          let currentIndex = s.currentIndex;
          if (from === s.currentIndex) {
            currentIndex = to;
          } else if (from < s.currentIndex && to >= s.currentIndex) {
            currentIndex = s.currentIndex - 1;
          } else if (from > s.currentIndex && to <= s.currentIndex) {
            currentIndex = s.currentIndex + 1;
          }
          return { queue: next, currentIndex };
        }),
      jumpToIndex: (index) =>
        set((s) => {
          if (index < 0 || index >= s.queue.length) return s;
          const next = s.queue[index];
          return {
            currentIndex: index,
            position: 0,
            isPlaying: true,
            videoLoading: !!next?.ytVideoId,
            playbackKey: s.playbackKey + 1,
          };
        }),
      removeFromQueue: (index) =>
        set((s) => {
          if (index < 0 || index >= s.queue.length) return s;
          const queue = [...s.queue.slice(0, index), ...s.queue.slice(index + 1)];
          // Removing the currently playing track restarts playback on the next
          // track (or stops if there isn't one).
          if (index === s.currentIndex) {
            if (queue.length === 0) {
              return { queue, currentIndex: -1, isPlaying: false, position: 0 };
            }
            const newIdx = Math.min(s.currentIndex, queue.length - 1);
            const next = queue[newIdx];
            return {
              queue,
              currentIndex: newIdx,
              position: 0,
              videoLoading: !!next?.ytVideoId,
              playbackKey: s.playbackKey + 1,
            };
          }
          // Removing something before the current track shifts the index down.
          if (index < s.currentIndex) {
            return { queue, currentIndex: s.currentIndex - 1 };
          }
          // Removing something after the current track leaves the index alone.
          return { queue };
        }),
      purgeTrack: (trackId) => {
        // Walk the queue once, dropping any matches and tracking how it shifts
        // the currentIndex / what the new active track is.
        const s = get();
        const queue: QueueTrack[] = [];
        let newCurrent = s.currentIndex;
        let activeRemoved = false;
        s.queue.forEach((t, i) => {
          if (t.id === trackId) {
            if (i < s.currentIndex) newCurrent--;
            else if (i === s.currentIndex) activeRemoved = true;
            return;
          }
          queue.push(t);
        });
        if (queue.length === 0) {
          set({ queue: [], currentIndex: -1, isPlaying: false, position: 0 });
          return;
        }
        if (activeRemoved) {
          newCurrent = Math.min(newCurrent, queue.length - 1);
          const next = queue[newCurrent];
          set({
            queue,
            currentIndex: newCurrent,
            position: 0,
            videoLoading: !!next?.ytVideoId,
            playbackKey: s.playbackKey + 1,
          });
        } else {
          set({ queue, currentIndex: newCurrent });
        }
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
      name: getPersistName(),
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
