"use client";

import { useRef, type KeyboardEvent, type WheelEvent, type PointerEvent } from "react";
import { computeAngularDelta, resetGesture, type WheelGestureState } from "./wheel-gestures";

export type WheelEventOut =
  | { type: "scroll"; delta: -1 | 1 }
  | { type: "select" }
  | { type: "menu" }
  | { type: "prev" }
  | { type: "next" }
  | { type: "playPause" };

export interface ClickWheelProps {
  onEvent: (e: WheelEventOut) => void;
  size?: number;
}

export function ClickWheel({ onEvent, size = 220 }: ClickWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<WheelGestureState>(resetGesture());
  const dragging = useRef(false);

  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        onEvent({ type: "scroll", delta: 1 });
        break;
      case "ArrowUp":
        e.preventDefault();
        onEvent({ type: "scroll", delta: -1 });
        break;
      case "Enter":
        e.preventDefault();
        onEvent({ type: "select" });
        break;
      case "Escape":
      case "Backspace":
        e.preventDefault();
        onEvent({ type: "menu" });
        break;
      case " ":
        e.preventDefault();
        onEvent({ type: "playPause" });
        break;
      case "ArrowLeft":
        e.preventDefault();
        onEvent({ type: "prev" });
        break;
      case "ArrowRight":
        e.preventDefault();
        onEvent({ type: "next" });
        break;
    }
  }

  function handleMouseWheel(e: WheelEvent) {
    if (e.deltaY === 0) return;
    onEvent({ type: "scroll", delta: e.deltaY > 0 ? 1 : -1 });
  }

  function handlePointerDown(e: PointerEvent) {
    dragging.current = true;
    gesture.current = resetGesture();
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging.current || !wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const { delta, newState } = computeAngularDelta(gesture.current, e.clientX, e.clientY, cx, cy);
    gesture.current = newState;
    if (delta !== 0) onEvent({ type: "scroll", delta: delta as -1 | 1 });
  }

  function handlePointerUp(e: PointerEvent) {
    dragging.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={wheelRef}
      data-testid="clickwheel"
      role="application"
      aria-label="iPod click wheel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleMouseWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative select-none rounded-full bg-gradient-to-b from-zinc-100 to-zinc-300 outline-none ring-zinc-400 focus:ring-2"
      style={{ width: size, height: size, touchAction: "none" }}
    >
      <button
        type="button"
        data-zone="menu"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "menu" });
        }}
        className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-bold text-zinc-600"
      >
        MENU
      </button>
      <button
        type="button"
        data-zone="next"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "next" });
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
      >
        ⏭
      </button>
      <button
        type="button"
        data-zone="playPause"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "playPause" });
        }}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 text-zinc-600"
      >
        ⏯
      </button>
      <button
        type="button"
        data-zone="prev"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "prev" });
        }}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
      >
        ⏮
      </button>
      <button
        type="button"
        data-zone="select"
        onClick={(e) => {
          e.stopPropagation();
          onEvent({ type: "select" });
        }}
        aria-label="select"
        className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-white to-zinc-300 shadow-inner"
      />
    </div>
  );
}
