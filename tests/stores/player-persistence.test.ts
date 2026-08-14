// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "kyowave-player:default";
const LEGACY_KEY = "music-universe-player:default";

const TRACKS = [
  { id: "t1", title: "One", duration: 200, artist: "A", album: "X" },
  { id: "t2", title: "Two", duration: 180, artist: "B", album: "Y" },
];

/**
 * jsdom here exposes a `localStorage` object with no setItem/clear, so the
 * persist middleware has nothing real to write to. Supply a working one.
 * It lives outside resetModules, so it survives a simulated reload — which
 * is exactly the behaviour under test.
 */
function installStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

let store: ReturnType<typeof installStorage>;

beforeEach(() => {
  vi.resetModules();
  store = installStorage();
});

/** Re-import the store as a fresh module — the closest thing to a page reload. */
async function reload() {
  vi.resetModules();
  return (await import("@/stores/player-store")).usePlayerStore;
}

describe("player persistence across a refresh", () => {
  it("writes the queue, index and position to localStorage", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue(TRACKS, 1);
    usePlayerStore.getState().setPosition(42);

    const saved = JSON.parse(store.getItem(KEY)!);
    expect(saved.state.queue).toHaveLength(2);
    expect(saved.state.currentIndex).toBe(1);
    expect(saved.state.position).toBe(42);
  });

  it("restores the queue and playhead after a reload", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue(TRACKS, 1);
    usePlayerStore.getState().setPosition(42);

    const reloaded = await reload();
    const s = reloaded.getState();
    expect(s.queue.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(s.currentIndex).toBe(1);
    expect(s.position).toBe(42);
    expect(s.currentTrack()?.title).toBe("Two");
  });

  it("comes back paused, never auto-playing", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue(TRACKS, 0); // setQueue starts playing
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    const reloaded = await reload();
    expect(reloaded.getState().isPlaying).toBe(false);
    // videoLoading is a transient gate; a restored session must not sit behind it.
    expect(reloaded.getState().videoLoading).toBe(false);
  });

  it("still persists the existing preferences", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setVolume(0.3);
    usePlayerStore.getState().setShuffle(true);
    usePlayerStore.getState().cycleRepeat();
    usePlayerStore.getState().setPerformanceMode(true);

    const reloaded = await reload();
    const s = reloaded.getState();
    expect(s.volume).toBeCloseTo(0.3);
    expect(s.shuffle).toBe(true);
    expect(s.repeat).not.toBe("off");
    expect(s.performanceMode).toBe(true);
  });

  it("carries state across the Music Universe -> Kyowave key rename", async () => {
    // The rename would otherwise silently wipe everyone's volume, shuffle,
    // repeat and — now that they persist — their queue and playhead.
    store.setItem(
      LEGACY_KEY,
      JSON.stringify({
        state: { volume: 0.25, shuffle: true, repeat: "all", performanceMode: false,
                 queue: TRACKS, currentIndex: 1, position: 99 },
        version: 0,
      }),
    );

    const reloaded = await reload();
    const s = reloaded.getState();
    expect(s.volume).toBeCloseTo(0.25);
    expect(s.queue.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(s.currentIndex).toBe(1);
    expect(s.position).toBe(99);
  });

  it("does not clobber existing Kyowave state with the legacy key", async () => {
    store.setItem(KEY, JSON.stringify({ state: { volume: 0.9 }, version: 0 }));
    store.setItem(LEGACY_KEY, JSON.stringify({ state: { volume: 0.1 }, version: 0 }));
    const reloaded = await reload();
    expect(reloaded.getState().volume).toBeCloseTo(0.9);
  });

  it("starts clean when there is nothing saved", async () => {
    const reloaded = await reload();
    const s = reloaded.getState();
    expect(s.queue).toEqual([]);
    expect(s.currentIndex).toBe(-1);
    expect(s.isPlaying).toBe(false);
  });
});
