"use client";

import { useEffect, useRef } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { createRoot } from "react-dom/client";
import { YtVideoPanel } from "./YtVideoPanel";

// VideoStage keeps a SINGLE YtVideoPanel instance alive for the whole session
// by maintaining a persistent DOM node that is physically moved (via native
// appendChild) into whichever slot is currently active:
//
//   data-video-slot="big"   → NowPlayingFull page
//   data-video-slot="small" → right-panel thumbnail
//
// Because we move the real DOM node rather than unmounting/remounting a React
// subtree, the YT iframe is never destroyed during slot transitions.
//
// This also eliminates all z-index battles: the iframe lives inside the slot
// as a normal child, so stacking order is irrelevant.

function findActiveSlot(): HTMLElement | null {
  // Prefer "big" if present (NowPlayingFull is showing)
  const big = document.querySelector<HTMLElement>('[data-video-slot="big"]');
  if (big) return big;
  return document.querySelector<HTMLElement>('[data-video-slot="small"]');
}

// Module-level singleton so we create exactly one container + React root for
// the entire browser session. The YT iframe survives page transitions.
let _container: HTMLDivElement | null = null;

function emitSlotMoved() {
  window.dispatchEvent(new CustomEvent("music-video-slot-moved"));
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent("music-video-slot-moved"));
  });
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("music-video-slot-moved"));
  }, 150);
}

function getOrCreateContainer(): HTMLDivElement {
  if (_container) return _container;
  const div = document.createElement("div");
  div.style.cssText = "width:100%;height:100%;display:block;";
  _container = div;
  // Render YtVideoPanel into this detached container.
  // Zustand stores are global so the panel's hooks work fine outside the
  // main React tree.
  const root = createRoot(div);
  root.render(<YtVideoPanel />);
  return div;
}

export function VideoStage() {
  const currentName = useIpodStore((s) => s.current().name);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = getOrCreateContainer();

    function updateSlot() {
      const slot = findActiveSlot();
      if (slot) {
        // Move only if not already inside the right slot
        if (container.parentElement !== slot) {
          slot.appendChild(container);
          emitSlotMoved();
        }
      } else if (container.parentElement) {
        // No active slot — detach so it doesn't pollute the DOM
        container.remove();
      }
    }

    // Debounce via rAF so layout has settled before we measure
    function schedule() {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updateSlot();
      });
    }

    // Initial placement
    schedule();

    // Re-place on navigation, resize, or any DOM mutation (slot appears/disappears)
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      obs.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentName]); // re-run when nav screen changes to catch new slots

  // VideoStage itself renders nothing — it only manages DOM placement
  return null;
}
