"use client";

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useIpodStore } from "@/stores/ipod-store";
import { getEngine } from "@/audio/engine";

// Returns `true` when the focused element accepts text input — typing in a
// search box or password field should never trigger playback shortcuts.
function isTypingInInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    // Allow shortcuts in checkbox / radio / range / button-style inputs.
    return !["checkbox", "radio", "range", "button", "submit", "reset"].includes(t);
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

export interface ShortcutEntry {
  combo: string;
  desc: string;
}

export const SHORTCUT_HELP: ShortcutEntry[] = [
  { combo: "Space", desc: "Play / pause" },
  { combo: "→", desc: "Seek forward 5s" },
  { combo: "←", desc: "Seek back 5s" },
  { combo: "Shift + →", desc: "Next track" },
  { combo: "Shift + ←", desc: "Previous track" },
  { combo: "↑ / ↓", desc: "Volume up / down" },
  { combo: "M", desc: "Mute toggle" },
  { combo: "S", desc: "Shuffle toggle" },
  { combo: "R", desc: "Cycle repeat mode" },
  { combo: "/", desc: "Focus search" },
  { combo: "?", desc: "Show this help" },
  { combo: "Esc", desc: "Close dialogs" },
];

/** Global keyboard shortcut handler. Mount once at the AppShell level. */
export function useKeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastVolume, setLastVolume] = useState(1); // remembered for mute toggle

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack keys while the user is typing in a search field, lyrics
      // textarea, password input, etc.
      if (isTypingInInput(e.target)) {
        // …with a couple of universal escape hatches:
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }

      const player = usePlayerStore.getState();
      const engine = getEngine();

      switch (e.key) {
        case " ":
        case "Spacebar":
          e.preventDefault();
          player.togglePlay();
          return;

        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            player.next();
          } else {
            const t = engine.getCurrentTime();
            engine.seek(t + 5);
            usePlayerStore.setState({ position: t + 5 });
          }
          return;

        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            player.prev();
          } else {
            const t = Math.max(0, engine.getCurrentTime() - 5);
            engine.seek(t);
            usePlayerStore.setState({ position: t });
          }
          return;

        case "ArrowUp":
          e.preventDefault();
          player.setVolume(Math.min(1, player.volume + 0.05));
          return;

        case "ArrowDown":
          e.preventDefault();
          player.setVolume(Math.max(0, player.volume - 0.05));
          return;

        case "m":
        case "M":
          e.preventDefault();
          if (player.volume === 0) {
            player.setVolume(lastVolume || 1);
          } else {
            setLastVolume(player.volume);
            player.setVolume(0);
          }
          return;

        case "s":
        case "S":
          e.preventDefault();
          player.setShuffle(!player.shuffle);
          return;

        case "r":
        case "R":
          e.preventDefault();
          player.cycleRepeat();
          return;

        case "/":
          // Slash focuses the global search. If we're not already on the
          // search screen, route there first.
          e.preventDefault();
          {
            const ipod = useIpodStore.getState();
            if (ipod.current().name !== "search") {
              ipod.toRoot();
              ipod.push({ name: "search" });
            }
            // Search input has data-shortcut="search" — focus it after the
            // route transition flushes.
            setTimeout(() => {
              const el = document.querySelector<HTMLInputElement>(
                'input[data-shortcut="search"]',
              );
              el?.focus();
            }, 0);
          }
          return;

        case "?":
          e.preventDefault();
          setHelpOpen((o) => !o);
          return;

        case "Escape":
          if (helpOpen) {
            e.preventDefault();
            setHelpOpen(false);
          }
          return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, lastVolume]);

  return { helpOpen, closeHelp: () => setHelpOpen(false) };
}
