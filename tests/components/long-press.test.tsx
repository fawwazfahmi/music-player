// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLongPress, LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE } from "@/hooks/use-long-press";

// Captured rather than rendered: `consumedRef` is a ref precisely because it
// must be readable in an event handler without waiting for a render, so
// asserting on it through the DOM would test React's scheduling, not the hook.
let consumed: { current: boolean } | null = null;

function Row({ onFire, enabled = true }: { onFire: () => void; enabled?: boolean }) {
  const { handlers, pressing, consumedRef } = useLongPress(onFire, { enabled });
  consumed = consumedRef;
  return (
    <div data-testid="row" data-pressing={pressing ? "1" : "0"} {...handlers}>
      row
    </div>
  );
}

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useLongPress", () => {
  it("fires after the hold threshold", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire if the finger lifts early", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchEnd(row);
    vi.advanceTimersByTime(500);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("cancels once the finger drifts past the tolerance", () => {
    // This is the one that makes long lists usable. Without it, flicking
    // through the library fires a menu on every row the thumb rests on.
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    fireEvent.touchMove(row, touch(100, 100 + LONG_PRESS_MOVE_TOLERANCE + 4));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("tolerates the jitter of a stationary thumb", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    fireEvent.touchMove(row, touch(101, 103));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("is cancelled by touchcancel, which iOS sends when a system gesture wins", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    fireEvent.touchCancel(row);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("fires once per gesture, not once per timer tick", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS * 5);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when disabled", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} enabled={false} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("marks the press consumed so the row's click doesn't also play the track", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    expect(consumed?.current).toBe(false);
    fireEvent.touchStart(row, touch(100, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    // A touch that opened a menu still emits a click on release; without the
    // consumed flag the track starts playing under the menu she just opened.
    expect(consumed?.current).toBe(true);
  });

  it("leaves the flag clear when the press was cancelled", () => {
    const onFire = vi.fn();
    render(<Row onFire={onFire} />);
    const row = screen.getByTestId("row");

    fireEvent.touchStart(row, touch(100, 100));
    fireEvent.touchMove(row, touch(100, 400));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    // A cancelled press is an ordinary tap, and an ordinary tap must play.
    expect(consumed?.current).toBe(false);
  });
});
