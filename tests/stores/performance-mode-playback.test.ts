// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRACK = { id: "t1", title: "One", duration: 200, artist: "A", album: "X", ytVideoId: "vid1" };
const AUDIO_ONLY = { id: "t2", title: "Two", duration: 100, artist: "B", album: "Y" };

beforeEach(() => {
  vi.resetModules();
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  });
});

/**
 * videoLoading gates engine.play() in AppShell, and YtVideoPanel is the only
 * thing that ever clears it. Performance Mode unmounts the stage that panel
 * lives in — so any videoLoading set while the mode is on can never be
 * cleared, and playback deadlocks in silence.
 */
describe("Performance Mode never gates playback on a video that isn't there", () => {
  it("does not raise the gate when starting a video track", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setPerformanceMode(true);
    usePlayerStore.getState().setQueue([TRACK], 0);

    const s = usePlayerStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.videoLoading).toBe(false); // would have been true, and stuck
  });

  it("still gates normally when Performance Mode is off", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue([TRACK], 0);
    expect(usePlayerStore.getState().videoLoading).toBe(true);
  });

  it("releases a gate that was already up when the mode is switched on", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue([TRACK], 0);
    expect(usePlayerStore.getState().videoLoading).toBe(true);

    usePlayerStore.getState().setPerformanceMode(true);
    expect(usePlayerStore.getState().videoLoading).toBe(false);
  });

  it("releases the gate via the toggle too", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue([TRACK], 0);
    usePlayerStore.getState().togglePerformanceMode();
    expect(usePlayerStore.getState().performanceMode).toBe(true);
    expect(usePlayerStore.getState().videoLoading).toBe(false);
  });

  it("keeps the gate down for audio-only tracks regardless of mode", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    usePlayerStore.getState().setQueue([AUDIO_ONLY], 0);
    expect(usePlayerStore.getState().videoLoading).toBe(false);
  });

  it("covers the other entry points into playback", async () => {
    const { usePlayerStore } = await import("@/stores/player-store");
    const st = () => usePlayerStore.getState();
    st().setPerformanceMode(true);

    st().addToQueue(TRACK); // empty queue -> starts playing
    expect(st().videoLoading).toBe(false);

    st().setQueue([], 0);
    st().addManyToQueue([TRACK, AUDIO_ONLY]);
    expect(st().videoLoading).toBe(false);

    st().setQueue([TRACK, AUDIO_ONLY], 0);
    st().jumpToIndex(1);
    expect(st().videoLoading).toBe(false);

    st().next();
    expect(st().videoLoading).toBe(false);
  });
});
