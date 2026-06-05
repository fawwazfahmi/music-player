"use client";

import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useIpodStore } from "@/stores/ipod-store";
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

function findActiveSlot(): HTMLElement | null {
  const big = document.querySelector<HTMLElement>('[data-video-slot="big"]');
  if (big) return big;
  return document.querySelector<HTMLElement>('[data-video-slot="small"]');
}

// Module-level singleton so we create exactly one container + React root for
// the entire browser session. The YT iframe survives page transitions.
let _container: HTMLDivElement | null = null;
let _initialized = false;

function emitSlotMoved() {
  window.dispatchEvent(new CustomEvent("music-video-slot-moved"));
}

function getOrCreateContainer(): HTMLDivElement {
  if (_container) return _container;
  const div = document.createElement("div");
  // Born offscreen but at a real video resolution so the YT iframe is created
  // at a size it can actually render at. If we start at 1x1, YT's video never
  // initializes and stays a black rectangle even after we resize the container.
  div.style.cssText = [
    "position:fixed",
    "top:-10000px",
    "left:0",
    "width:640px",
    "height:360px",
    "z-index:5",
    "overflow:hidden",
    "transition:top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease",
    "pointer-events:none",
    "background:black",
  ].join(";");
  document.body.appendChild(div);
  _container = div;

  // Render YtVideoPanel into this stable container — never reparented, never
  // unmounted. The iframe inside is born here and dies here.
  const root = createRoot(div);
  root.render(<YtVideoPanel />);
  _initialized = true;
  return div;
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
          emitSlotMoved();
        }
        return;
      }
      const r = slot.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // not yet laid out
      container.style.top = `${r.top}px`;
      container.style.left = `${r.left}px`;
      container.style.width = `${r.width}px`;
      container.style.height = `${r.height}px`;

      if (slot !== lastSlot) {
        lastSlot = slot;
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

    window.addEventListener("resize", scheduleApply);
    window.addEventListener("scroll", scheduleApply, true);

    // Watch for slot insertion/removal as user navigates
    const mutation = new MutationObserver(scheduleApply);
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("scroll", scheduleApply, true);
      mutation.disconnect();
      observer?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentName]);

  // Enable pointer events on the container only when it's overlaying a slot
  // (i.e. not parked offscreen). Otherwise the user can't interact with the
  // app while the container floats invisibly.
  useEffect(() => {
    if (!_initialized || !_container) return;
    // Use a periodic check so the click-through stays correct as slots come/go
    const id = window.setInterval(() => {
      if (!_container) return;
      const offscreen = _container.style.top.startsWith("-");
      _container.style.pointerEvents = offscreen ? "none" : "auto";
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
