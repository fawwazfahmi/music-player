"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  bumpLongPressCount,
  readLongPressCount,
  readMenuButtonPref,
  shouldShowLongPressTip,
  shouldShowMenuButton,
  writeMenuButtonPref,
  type MenuButtonPref,
} from "@/lib/mobile";

export interface MenuPrefsSnapshot {
  pref: MenuButtonPref;
  longPressCount: number;
}

// Every row on screen reads this, and a successful long-press in one of them
// must retire the ⋮ in all the others at once. localStorage has no same-tab
// change event, so the writes below notify explicitly.
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // The `storage` event only fires for *other* tabs, which is exactly the case
  // the local set above doesn't cover.
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

// useSyncExternalStore compares snapshots by identity, so a fresh object every
// call would loop forever. Cache one and only replace it when a value actually
// changed.
const SERVER_SNAPSHOT: MenuPrefsSnapshot = { pref: "until-learned", longPressCount: 0 };
let cached: MenuPrefsSnapshot = SERVER_SNAPSHOT;
let cachedKey = "";

function getSnapshot(): MenuPrefsSnapshot {
  const pref = readMenuButtonPref();
  const longPressCount = readLongPressCount();
  const key = `${pref}:${longPressCount}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = { pref, longPressCount };
  }
  return cached;
}

function getServerSnapshot(): MenuPrefsSnapshot {
  return SERVER_SNAPSHOT;
}

/**
 * Whether a row shows its ⋮, and whether the menu still teaches the gesture.
 *
 * The server snapshot is the default rather than the stored value because
 * localStorage does not exist during SSR. React expects the two to differ and
 * re-renders after hydration without complaint — reading storage in an effect
 * instead would be a setState-in-effect, and reading it during render would be
 * a hydration mismatch.
 */
export function useMenuPrefs(isTouch: boolean) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const recordLongPress = useCallback(() => {
    bumpLongPressCount();
    emit();
  }, []);

  const setPref = useCallback((pref: MenuButtonPref) => {
    writeMenuButtonPref(pref);
    emit();
  }, []);

  return {
    pref: snap.pref,
    longPressCount: snap.longPressCount,
    // On a device with hover the ⋮ is not training wheels, it is the only way
    // in — the row reveals it on hover and always has.
    showButton: !isTouch || shouldShowMenuButton(snap.pref, snap.longPressCount),
    showTip: shouldShowLongPressTip(snap.pref, snap.longPressCount, isTouch),
    recordLongPress,
    setPref,
  };
}
