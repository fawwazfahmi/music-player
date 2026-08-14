"use client";

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { YtVideoPanel } from "./YtVideoPanel";

// VideoStage keeps a SINGLE YtVideoPanel instance alive for the whole session,
// rendered into a position:fixed container at the document root. The container
// repositions itself via CSS to overlay whichever slot is currently active:
//
//   data-video-slot="big"   → NowPlayingFull page
//   data-video-slot="small" → right-panel thumbnail
//
// We use CSS positioning (not DOM reparenting) because browsers reload iframes
// when their parent element changes — which would reset YT to its original src
// videoId, defeating the whole point of keeping the player alive.

//   data-video-slot="sheet" → mobile now-playing sheet (wins when present)
//
// The mobile sheet is checked first because it only exists in the DOM while
// the sheet is open, and while it is open it is the only thing on screen.
// Checking it after "big" would hand the iframe to a nowPlayingFull slot
// sitting behind the sheet, where nobody can see it.
/**
 * A slot only counts if it is actually on screen.
 *
 * Without this, a slot that exists in the DOM but is laid out at 0x0 — a
 * `md:hidden` mobile sheet while on desktop, a panel behind `display:none` —
 * still wins the lookup, and the iframe never reaches the slot that IS
 * visible. That regressed the desktop right-panel video the moment the mobile
 * sheet started declaring a slot of its own.
 */
function visibleSlot(name: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-video-slot="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function findActiveSlot(): HTMLElement | null {
  return visibleSlot("sheet") ?? visibleSlot("big") ?? visibleSlot("small");
}

// Debug-flag: set window.__MU_DEBUG_VIDEO__ = true in the console to log
// VideoStage placement decisions. Helps diagnose 'iframe blank black'
// reports where the symptom is the slot mounting before the container
// can attach, or the wrong slot being detected.
function debugLog(...args: unknown[]) {
  if (typeof window !== "undefined" && (window as unknown as { __MU_DEBUG_VIDEO__?: boolean }).__MU_DEBUG_VIDEO__) {
    console.log("[mu] VideoStage:", ...args);
  }
}

// Module-level singleton so we create exactly one container + React root for
// the entire browser session. The YT iframe survives page transitions.
//
// The root is kept here, not as a local, so teardownVideoStage() can actually
// unmount it. Without that handle the iframe outlived the component: turning
// Performance Mode on unmounted <VideoStage /> but left the container sitting
// on document.body at z-index 40, still covering the cover art beneath it.
let _container: HTMLDivElement | null = null;
let _root: Root | null = null;

/**
 * Ask the stage to re-measure its slot.
 *
 * Dispatched by anything that moves a slot in a way the browser doesn't
 * report — chiefly a CSS transform, which fires neither resize nor scroll.
 */
export const VIDEO_REFLOW_EVENT = "kyowave-video-reflow";

/** Easing used when the video moves between slots. Suspended during a drag. */
const SLOT_TRANSITION =
  "top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease";

function emitSlotMoved() {
  window.dispatchEvent(new CustomEvent("music-video-slot-moved"));
}

function getOrCreateContainer(): HTMLDivElement {
  if (_container) return _container;
  const div = document.createElement("div");
  div.setAttribute("data-music-video-stage", "");
  // Born offscreen but at a real video resolution so the YT iframe is created
  // at a size it can actually render at. If we start at 1x1, YT's video never
  // initializes and stays a black rectangle even after we resize the container.
  div.style.cssText = [
    "position:fixed",
    "top:-10000px",
    "left:0px",
    "width:640px",
    "height:360px",
    "z-index:40", // above sidebar (z-30) + player bar; below mobile drawers' backdrop
    "overflow:hidden",
    `transition:${SLOT_TRANSITION}`,
    // pointer-events:none → clicks pass through to whatever's beneath (the
    // slot's Expand button, app controls, etc). The user controls playback
    // via the player bar, not YT's native iframe controls.
    "pointer-events:none",
    "background:black",
    "display:block",
    "visibility:visible",
  ].join(";");
  document.body.appendChild(div);
  _container = div;

  // Render YtVideoPanel into this stable container. Never reparented — the
  // iframe reloads if its parent changes. It is torn down only when the stage
  // itself unmounts (Performance Mode), via teardownVideoStage().
  const root = createRoot(div);
  root.render(<YtVideoPanel />);
  _root = root;
  return div;
}

/**
 * Destroy the stage: unmount the panel and remove the container from the DOM.
 *
 * Called when <VideoStage /> unmounts, which happens when Performance Mode is
 * switched on. Because the container is created imperatively on document.body
 * rather than through React's tree, unmounting the component alone leaves the
 * live YouTube iframe on screen.
 *
 * The unmount is deferred by a tick: React throws if a root is unmounted while
 * another root is mid-render, and this is called from an effect cleanup.
 */
export function teardownVideoStage(): void {
  // Open the audio gate before anything else. YtVideoPanel is the only thing
  // that clears `videoLoading`, and it is about to stop existing — a track
  // that was mid-gate when this ran would otherwise stay silent forever.
  // On mobile this fires every time the sheet closes or the screen locks, so
  // it is the difference between music that survives a pocket and music that
  // doesn't.
  usePlayerStore.getState().setVideoLoading(false);

  const root = _root;
  const container = _container;
  _root = null;
  _container = null;
  if (!root && !container) return;
  setTimeout(() => {
    root?.unmount();
    container?.remove();
  }, 0);
}

export function VideoStage() {
  const currentName = useIpodStore((s) => s.current().name);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = getOrCreateContainer();
    let observer: ResizeObserver | null = null;
    let lastSlot: HTMLElement | null = null;

    function applyRect() {
      const slot = findActiveSlot();
      if (!slot) {
        // No slot in DOM → park container offscreen at a real size so the
        // iframe stays alive and renderable (don't shrink to 1x1).
        container.style.top = "-10000px";
        container.style.left = "0px";
        container.style.width = "640px";
        container.style.height = "360px";
        if (lastSlot !== null) {
          lastSlot = null;
          debugLog("no slot — parking offscreen");
          emitSlotMoved();
        }
        return;
      }
      const r = slot.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        debugLog("slot has zero size, skipping", {
          slot: slot.getAttribute("data-video-slot"),
          width: r.width,
          height: r.height,
        });
        return; // not yet laid out
      }
      container.style.top = `${r.top}px`;
      container.style.left = `${r.left}px`;
      container.style.width = `${r.width}px`;
      container.style.height = `${r.height}px`;

      if (slot !== lastSlot) {
        lastSlot = slot;
        debugLog("moved to slot", {
          slot: slot.getAttribute("data-video-slot"),
          rect: { top: r.top, left: r.left, w: r.width, h: r.height },
        });
        // Rewire ResizeObserver to follow the new slot
        observer?.disconnect();
        observer = new ResizeObserver(scheduleApply);
        observer.observe(slot);
        emitSlotMoved();
      }
    }

    function scheduleApply() {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyRect();
      });
    }

    scheduleApply();

    // The container eases between slots, which is right when the video jumps
    // from the panel to fullscreen — and wrong during a drag, where it has to
    // track the finger exactly. Easing there leaves the video visibly trailing
    // the sheet by a fifth of a second, which is most of what "glitchy" was.
    // Cut the easing for the duration of the gesture, restore once it settles.
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    function applyImmediate() {
      container.style.transition = "none";
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        container.style.transition = SLOT_TRANSITION;
      }, 200);
      scheduleApply();
    }

    window.addEventListener("resize", scheduleApply);
    window.addEventListener("scroll", scheduleApply, true);
    window.addEventListener(VIDEO_REFLOW_EVENT, applyImmediate);

    // Watch for slot insertion/removal as user navigates
    const mutation = new MutationObserver(scheduleApply);
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("scroll", scheduleApply, true);
      window.removeEventListener(VIDEO_REFLOW_EVENT, applyImmediate);
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      mutation.disconnect();
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentName]);

  // Teardown lives in its own effect with no dependencies, so it runs only on
  // a real unmount. The positioning effect above re-runs on every screen
  // change; tearing down there would destroy and recreate the iframe on each
  // navigation, which is the exact thing the single-stage design prevents.
  useEffect(() => teardownVideoStage, []);

  // Container stays pointer-events:none always so app controls (player bar,
  // Expand button, sidebar nav) remain clickable through it. No periodic
  // toggle needed.

  return null;
}
