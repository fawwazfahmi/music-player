"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a finger must rest before the menu opens. */
export const LONG_PRESS_MS = 450;

/**
 * How far the finger may drift before we decide this is a scroll, not a press.
 *
 * This is the single most important number in the file. Without a movement
 * cancel, flicking through a long song list fires a menu on every row the
 * finger happens to rest on, which makes the list unusable. 8px is roughly the
 * jitter of a stationary thumb on a 3x display.
 */
export const LONG_PRESS_MOVE_TOLERANCE = 8;

export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export interface UseLongPressResult {
  handlers: LongPressHandlers;
  /** True while a press is being timed — drive the scale/ring feedback off this. */
  pressing: boolean;
  /**
   * True once the press has fired. The row's click handler must check this and
   * skip playback, because a touch that opened a menu still emits a click.
   */
  consumedRef: React.RefObject<boolean>;
}

/**
 * Press-and-hold, cancelled by movement.
 *
 * iOS Safari has never supported `navigator.vibrate`, so there is no haptic to
 * confirm the press — the caller renders the feedback from `pressing`.
 */
export function useLongPress(
  onLongPress: () => void,
  options: { enabled?: boolean } = {},
): UseLongPressResult {
  const { enabled = true } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const consumedRef = useRef(false);
  const callbackRef = useRef(onLongPress);
  const [pressing, setPressing] = useState(false);

  // Kept fresh in an effect rather than assigned during render: the timer
  // closes over this ref, so it must always hold the latest callback, but
  // writing a ref while rendering is not allowed.
  useEffect(() => {
    callbackRef.current = onLongPress;
  });

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    setPressing(false);
  }, []);

  // A press timer must never outlive the row that started it — a list that
  // re-renders mid-press would otherwise fire a menu for a track that is no
  // longer under the finger.
  useEffect(() => clear, [clear]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const t = e.touches[0];
      if (!t) return;
      consumedRef.current = false;
      originRef.current = { x: t.clientX, y: t.clientY };
      setPressing(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        consumedRef.current = true;
        setPressing(false);
        callbackRef.current();
      }, LONG_PRESS_MS);
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const origin = originRef.current;
      const t = e.touches[0];
      if (!origin || !t) return;
      const drift = Math.hypot(t.clientX - origin.x, t.clientY - origin.y);
      if (drift > LONG_PRESS_MOVE_TOLERANCE) clear();
    },
    [clear],
  );

  const onTouchEnd = useCallback(() => clear(), [clear]);

  // Desktop right-click and iOS's own press-and-hold both land here. Suppressing
  // it stops Safari's copy/lookup bubble appearing over our menu; the row also
  // carries -webkit-touch-callout:none, and both are needed.
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
    },
    [enabled],
  );

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, onContextMenu },
    pressing,
    consumedRef,
  };
}
