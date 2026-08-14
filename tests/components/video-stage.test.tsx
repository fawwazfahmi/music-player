// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The real panel loads the YouTube iframe API off the network. We only care
// about the stage's container lifecycle here.
vi.mock("@/components/player/YtVideoPanel", () => ({
  YtVideoPanel: () => null,
  loadIframeAPI: async () => {},
}));

beforeEach(() => {
  vi.resetModules();
  // jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-music-video-stage]").forEach((n) => n.remove());
  vi.unstubAllGlobals();
});

const STAGE = "[data-music-video-stage]";

describe("VideoStage lifecycle", () => {
  it("creates a single fixed container holding the player", async () => {
    const { VideoStage } = await import("@/components/player/VideoStage");
    render(<VideoStage />);
    expect(document.querySelectorAll(STAGE)).toHaveLength(1);
  });

  it("removes the container when it unmounts", async () => {
    // Performance mode unmounts <VideoStage /> via
    //   {!player.performanceMode && <VideoStage />}
    // in AppShell. The container lives on document.body via an imperative
    // createRoot, outside React's tree, so unmounting the component has to
    // tear it down explicitly — otherwise the live YouTube iframe stays in
    // the DOM at z-index 40 and keeps covering the performance-mode cover.
    const { VideoStage } = await import("@/components/player/VideoStage");
    const view = render(<VideoStage />);
    expect(document.querySelector(STAGE)).not.toBeNull();

    view.unmount();
    await new Promise((r) => setTimeout(r, 0)); // unmount is deferred a tick

    expect(document.querySelector(STAGE)).toBeNull();
  });

  it("does not tear down while merely navigating between screens", async () => {
    // The positioning effect re-runs on every screen change. Tearing down
    // there would destroy and recreate the iframe on each navigation, which
    // is exactly what the single-stage design exists to prevent.
    const ipod = await import("@/stores/ipod-store");
    const { VideoStage } = await import("@/components/player/VideoStage");
    render(<VideoStage />);
    const first = document.querySelector(STAGE);
    expect(first).not.toBeNull();

    ipod.useIpodStore.getState().push({ name: "songList" });
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(STAGE)).toBe(first);
  });

  it("can be mounted again after a teardown", async () => {
    // Toggling performance mode off should bring the video back.
    const { VideoStage } = await import("@/components/player/VideoStage");
    const view = render(<VideoStage />);
    view.unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(STAGE)).toBeNull();

    render(<VideoStage />);
    expect(document.querySelectorAll(STAGE)).toHaveLength(1);
  });
});
