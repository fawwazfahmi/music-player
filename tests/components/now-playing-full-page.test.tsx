// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The rail seeds its heart from a server action; the scrubber talks to the
// audio engine. Neither is what these tests are about, and the real modules
// reach for the database / an <audio> element.
vi.mock("@/server/actions/favorites", () => ({
  isFavorited: async () => false,
  toggleFavorite: async () => true,
}));
vi.mock("@/audio/engine", () => ({
  getEngine: () => ({ seek: () => {}, getCurrentTime: () => 0, getDuration: () => 0 }),
}));

import { NowPlayingFullPage } from "@/components/pages/NowPlayingFullPage";
import { usePlayerStore } from "@/stores/player-store";

const YT_TRACK = {
  id: "t1",
  title: "Runaway",
  artist: "Aurora Lane",
  album: "Sunset",
  duration: 253,
  coverArtHash: null,
  ytVideoId: "abc123",
};

const LOCAL_TRACK = { ...YT_TRACK, id: "t2", ytVideoId: null };

beforeEach(() => {
  usePlayerStore.setState({
    queue: [],
    currentIndex: -1,
    performanceMode: false,
    videoLoading: false,
    position: 0,
  });
});

afterEach(cleanup);

const bigSlot = () => document.querySelector('[data-video-slot="big"]');

describe("NowPlayingFullPage video slot", () => {
  it("declares the big slot for a YouTube track", () => {
    usePlayerStore.setState({ queue: [YT_TRACK], currentIndex: 0 });
    render(<NowPlayingFullPage />);
    expect(bigSlot()).not.toBeNull();
  });

  it("declares no slot in performance mode", () => {
    // The invariant that keeps the iframe from being handed to a slot nobody
    // can see: performance mode unmounts the video stage entirely, so a slot
    // left declared here would claim a video that no longer exists.
    usePlayerStore.setState({
      queue: [YT_TRACK],
      currentIndex: 0,
      performanceMode: true,
    });
    render(<NowPlayingFullPage />);
    expect(bigSlot()).toBeNull();
    expect(screen.getByText("Performance mode — video hidden")).toBeInTheDocument();
  });

  it("declares no slot for a track without a video", () => {
    usePlayerStore.setState({ queue: [LOCAL_TRACK], currentIndex: 0 });
    render(<NowPlayingFullPage />);
    expect(bigSlot()).toBeNull();
    expect(screen.getByText("No video for this track")).toBeInTheDocument();
  });

  it("declares no slot with an empty queue", () => {
    render(<NowPlayingFullPage />);
    expect(bigSlot()).toBeNull();
    expect(screen.getByText("Pick a song to see it here.")).toBeInTheDocument();
  });
});

describe("NowPlayingFullPage chrome", () => {
  it("keeps the exit rail on every branch that has a track", () => {
    usePlayerStore.setState({ queue: [LOCAL_TRACK], currentIndex: 0 });
    render(<NowPlayingFullPage />);
    expect(screen.getByLabelText("Exit full video")).toBeInTheDocument();
    expect(screen.getByLabelText("Show the queue")).toBeInTheDocument();
  });

  it("points the right panel at the queue from the rail", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    usePlayerStore.setState({ queue: [YT_TRACK], currentIndex: 0 });
    render(<NowPlayingFullPage />);
    expect(usePlayerStore.getState().rightPanelTab).toBe("lyrics");

    await userEvent.click(screen.getByLabelText("Show the queue"));

    expect(usePlayerStore.getState().rightPanelTab).toBe("queue");
  });

  it("shows the track meta instead of the old header block", () => {
    usePlayerStore.setState({ queue: [YT_TRACK], currentIndex: 0 });
    render(<NowPlayingFullPage />);
    expect(screen.getByText("Now playing")).toBeInTheDocument();
    expect(screen.getByText("Runaway")).toBeInTheDocument();
    // 253s — the scrubber's duration read-out.
    expect(screen.getByText("4:13")).toBeInTheDocument();
  });
});
