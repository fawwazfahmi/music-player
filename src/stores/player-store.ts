import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Identity-scope the localStorage key so two tabs in the same browser
// running the app as different people (ainul vs fawwaz) keep separate
// preferences and queues. Read the mu_name cookie once at module load — fall
// back to a shared "default" key when no cookie is present (SSR or pre-login).
const KEY_PREFIX = "kyowave-player:";
const LEGACY_KEY_PREFIX = "music-universe-player:";

function getPersistName(): string {
  if (typeof document === "undefined") return `${KEY_PREFIX}ssr`;
  const m = /(?:^|;\s*)mu_name=([^;]+)/.exec(document.cookie);
  const name = m ? decodeURIComponent(m[1]!).toLowerCase() : "default";
  return `${KEY_PREFIX}${name}`;
}

/**
 * Carry saved state across the Music Universe → Kyowave key rename.
 *
 * Runs once at module load, before persist reads. Without it the rename
 * silently wipes everyone's volume, shuffle, repeat and — now that they are
 * persisted — their queue and playhead.
 */
function migrateLegacyKey(key: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage?.getItem) return;
    if (window.localStorage.getItem(key)) return;
    const legacy = window.localStorage.getItem(key.replace(KEY_PREFIX, LEGACY_KEY_PREFIX));
    if (legacy) window.localStorage.setItem(key, legacy);
  } catch {
    /* storage disabled or full — starting fresh is acceptable here */
  }
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
  // True while we're waiting for the YT iframe to load before starting
  // playback. Transient; not persisted.
  //
  // INVARIANT: only ever true when a video stage exists to clear it.
  // YtVideoPanel is the sole thing that sets it false, and Performance Mode
  // unmounts the stage entirely — so setting this while Performance Mode is
  // on deadlocks playback permanently: the gate opens for nobody and no audio
  // ever starts. Every assignment below is gated on !performanceMode, and
  // switching the mode on clears any gate already in flight.
  videoLoading: boolean;
  // Increments whenever playback is intentionally restarted or moved to a new
  // queue item, even if the YouTube video id is the same.
  playbackKey: number;
  /** Performance mode — turns off the YouTube iframe video, smooth-scroll
      animations, and other GPU/CPU expensive eye candy. Designed for users
      who want music in a second tab while gaming. Persisted per-device. */
  performanceMode: boolean;
  /** Whether audio is allowed to wait for the video at all.
      Set false on touch devices — see `videoGateOpen`. Not persisted: it
      describes the device, and is decided fresh on every mount. */
  videoGateEnabled: boolean;
  /** Mobile sheet — show album art in place of the video. Hers to toggle;
      performance mode forces it on. Persisted per-device. */
  mobileArtMode: boolean;
  /** Whether a slot is currently on screen for the video to occupy: always
      true on desktop, and on mobile only while the sheet is open.
      The iframe stays ALIVE when this is false and merely pauses — rebuilding
      it on every sheet open cost a visible second of black, and sometimes it
      never started at all. Not persisted. */
  videoPresenting: boolean;
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
  /** Repaint a track's art everywhere it appears in the queue after the user
      picks a new cover. Keeps the player bar, queue panel and now-playing in
      sync without interrupting playback. */
  setTrackCoverArt: (trackId: string, coverArtHash: string | null) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  setPosition: (p: number) => void;
  setVideoLoading: (v: boolean) => void;
  setPerformanceMode: (v: boolean) => void;
  togglePerformanceMode: () => void;
  setVideoGateEnabled: (v: boolean) => void;
  setVideoPresenting: (v: boolean) => void;
  setMobileArtMode: (v: boolean) => void;
  toggleMobileArtMode: () => void;
}

/**
 * May audio wait for the YouTube iframe before starting?
 *
 * Two things can close the gate permanently, and both have caused silent
 * playback before:
 *
 *   - Performance mode unmounts the video stage, so nothing is left to clear
 *     `videoLoading` and the gate opens for nobody.
 *   - On a phone the iframe is torn down whenever the sheet closes or the
 *     screen locks. A gate set just before a teardown would strand her music
 *     paused until she found the sheet again.
 *
 * Rather than remember to check both at eleven call sites, every site asks
 * this one question.
 */
export function videoGateOpen(s: {
  performanceMode: boolean;
  videoGateEnabled: boolean;
}): boolean {
  return !s.performanceMode && s.videoGateEnabled;
}

/**
 * A storage object that is safe to call, whatever the environment hands us.
 *
 * Three cases have to work:
 *   - the server, where there is no window at all;
 *   - a browser with storage switched off, which is Safari private mode and any
 *     locked-down profile — persist writes on nearly every action, so an
 *     unguarded `setItem` there takes the whole app down on the first play;
 *   - Node, where the bare `localStorage` identifier can resolve to Node's own
 *     experimental global, which is an inert object with no methods unless
 *     --localstorage-file points somewhere real.
 *
 * In all three the app runs; it just forgets preferences between visits, which
 * is the correct thing to degrade to.
 */
function usableStorage(): Storage {
  const memory = new Map<string, string>();
  const fallback = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => Array.from(memory.keys())[i] ?? null,
    get length() {
      return memory.size;
    },
  } as Storage;

  if (typeof window === "undefined") return fallback;
  try {
    const ls = window.localStorage;
    if (typeof ls?.getItem !== "function" || typeof ls?.setItem !== "function") {
      return fallback;
    }
    return ls;
  } catch {
    // Merely reading window.localStorage throws when cookies are blocked.
    return fallback;
  }
}

const PERSIST_KEY = getPersistName();
migrateLegacyKey(PERSIST_KEY);

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
      performanceMode: false,
      videoGateEnabled: true,
      mobileArtMode: false,
      videoPresenting: true,
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
          videoLoading: hasVideo && videoGateOpen(get()),
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
              videoLoading: !!track.ytVideoId && videoGateOpen(get()),
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
              videoLoading: !!first.ytVideoId && videoGateOpen(get()),
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
              videoLoading: !!track.ytVideoId && videoGateOpen(get()),
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
            videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
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
              videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
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
      setTrackCoverArt: (trackId, coverArtHash) =>
        set((s) => {
          if (!s.queue.some((t) => t.id === trackId)) return s;
          return {
            queue: s.queue.map((t) =>
              t.id === trackId ? { ...t, coverArtHash } : t,
            ),
          };
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
            videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
            playbackKey: s.playbackKey + 1,
          });
        } else {
          set({ queue, currentIndex: newCurrent });
        }
      },
      next: () =>
        set((s) => {
          if (s.queue.length === 0) return s;

          let nextIdx: number;
          if (s.shuffle && s.queue.length > 1) {
            // Pick a random index that isn't the current one. Doesn't track
            // history, so two adjacent shuffles can revisit a track — fine
            // for casual listening, matches the Spotify default.
            do {
              nextIdx = Math.floor(Math.random() * s.queue.length);
            } while (nextIdx === s.currentIndex);
          } else if (s.currentIndex < s.queue.length - 1) {
            nextIdx = s.currentIndex + 1;
          } else if (s.repeat === "all") {
            nextIdx = 0;
          } else {
            return { isPlaying: false };
          }

          const next = s.queue[nextIdx];
          return {
            currentIndex: nextIdx,
            position: 0,
            videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
            playbackKey: s.playbackKey + 1,
          };
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
              videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
              playbackKey: s.playbackKey + 1,
            };
          }
          if (s.repeat === "all") {
            const next = s.queue[s.queue.length - 1];
            return {
              currentIndex: s.queue.length - 1,
              position: 0,
              videoLoading: !!next?.ytVideoId && videoGateOpen(get()),
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
      setPerformanceMode: (v) =>
        // Clearing videoLoading matters: if a track was mid-gate when the mode
        // flipped, the stage unmounts and nothing would ever open it again.
        set(v ? { performanceMode: true, videoLoading: false } : { performanceMode: v }),
      togglePerformanceMode: () =>
        set((s) =>
          s.performanceMode
            ? { performanceMode: false }
            : { performanceMode: true, videoLoading: false },
        ),
      // Disabling clears any gate already in flight, for the same reason
      // setPerformanceMode does: the thing that would have opened it is about
      // to stop existing.
      setVideoGateEnabled: (v) =>
        set(v ? { videoGateEnabled: true } : { videoGateEnabled: false, videoLoading: false }),
      setVideoPresenting: (v) => set({ videoPresenting: v }),
      setMobileArtMode: (v) => set({ mobileArtMode: v }),
      toggleMobileArtMode: () => set((s) => ({ mobileArtMode: !s.mobileArtMode })),
    }),
    {
      // Per-device persistence: localStorage on the user's own machine.
      // Only saves preferences (volume, shuffle, repeat) — never queue/playback state.
      name: PERSIST_KEY,
      storage: createJSONStorage(usableStorage),
      partialize: (state) => ({
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
        performanceMode: state.performanceMode,
        mobileArtMode: state.mobileArtMode,
        // Survive a refresh. Without these the queue, which song was playing
        // and how far in all vanished on reload.
        queue: state.queue,
        currentIndex: state.currentIndex,
        position: state.position,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Come back paused, parked at the saved position — never auto-play.
        // That is what was asked for, and browsers block autoplay without a
        // user gesture anyway, so restoring isPlaying:true would just leave
        // the UI claiming to play while silent.
        state.isPlaying = false;
        state.videoLoading = false;
      },
    },
  ),
);
