import { beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "@/stores/player-store";

const track = (id: string) => ({ id, title: id, duration: 100, artist: "A", album: "Al" });

describe("player-store", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      shuffle: false,
      repeat: "off",
      volume: 1,
      position: 0,
    });
  });

  it("setQueue replaces the queue and sets currentIndex", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    expect(usePlayerStore.getState().queue).toHaveLength(2);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("next/prev navigate within queue", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b"), track("c")], 0);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("next at end stops when repeat=off", () => {
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("next at end wraps when repeat=all", () => {
    usePlayerStore.setState({ repeat: "all" });
    usePlayerStore.getState().setQueue([track("a"), track("b")], 1);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });
});
