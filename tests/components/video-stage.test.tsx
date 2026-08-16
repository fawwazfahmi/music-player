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

  it("rounds the container to match the full-video slot", async () => {
    // The container is a position:fixed overlay, so it inherits nothing from
    // the slot beneath it. Without a matching radius the iframe paints square
    // corners over the rounded stage in full video mode.
    const { VideoStage } = await import("@/components/player/VideoStage");
    render(<VideoStage />);
    const stage = document.querySelector<HTMLElement>(STAGE)!;
    expect(stage.style.borderRadius).toBe("14px");
    expect(stage.style.overflow).toBe("hidden");
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

describe("VideoStage slot occupancy", () => {
  /** jsdom gives every element a 0x0 rect, so a slot has to be faked. */
  function withRect(el: HTMLElement, rect: Partial<DOMRect>) {
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 320, height: 180, ...rect }) as DOMRect;
  }

  it("stays hidden while no slot exists", async () => {
    const { VideoStage } = await import("@/components/player/VideoStage");
    render(<VideoStage />);
    const stage = document.querySelector<HTMLElement>(STAGE)!;
    expect(stage.style.visibility).toBe("hidden");
  });

  it("hides again the moment a slot stops claiming the video", async () => {
    // The bug this guards, caught on video: the mobile sheet stays mounted and
    // toggles `data-video-slot` on and off rather than being removed. The
    // MutationObserver watched only childList, so closing the sheet fired
    // nothing — and the video stayed painted over the library list until some
    // unrelated scroll happened to trigger a re-measure.
    const { VideoStage } = await import("@/components/player/VideoStage");
    const slot = document.createElement("div");
    slot.setAttribute("data-video-slot", "sheet");
    withRect(slot, { top: 40, left: 0, width: 320, height: 180 });
    document.body.appendChild(slot);

    render(<VideoStage />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const stage = document.querySelector<HTMLElement>(STAGE)!;
    expect(stage.style.visibility).toBe("visible");
    expect(stage.style.top).toBe("40px");

    slot.removeAttribute("data-video-slot");
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(stage.style.visibility).toBe("hidden");
    slot.remove();
  });

  it("ignores a slot that is present but laid out at zero size", async () => {
    // The desktop right panel is `hidden md:block`; on a phone its slot is
    // still in the DOM at 0x0. Letting it win starved the visible slot.
    const { VideoStage } = await import("@/components/player/VideoStage");
    const hidden = document.createElement("div");
    hidden.setAttribute("data-video-slot", "small");
    withRect(hidden, { width: 0, height: 0 });
    document.body.appendChild(hidden);

    render(<VideoStage />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.querySelector<HTMLElement>(STAGE)!.style.visibility).toBe("hidden");
    hidden.remove();
  });
});
