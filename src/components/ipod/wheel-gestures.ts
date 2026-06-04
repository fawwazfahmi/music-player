export interface WheelGestureState {
  lastAngle: number | null;
  accumulator: number;
}

const SCROLL_ANGLE_THRESHOLD = 15; // degrees

export function computeAngularDelta(state: WheelGestureState, x: number, y: number, cx: number, cy: number): { delta: number; newState: WheelGestureState } {
  const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
  if (state.lastAngle === null) {
    return { delta: 0, newState: { lastAngle: angle, accumulator: 0 } };
  }
  let diff = angle - state.lastAngle;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  const newAccumulator = state.accumulator + diff;
  if (Math.abs(newAccumulator) >= SCROLL_ANGLE_THRESHOLD) {
    const delta = newAccumulator > 0 ? 1 : -1;
    return { delta, newState: { lastAngle: angle, accumulator: newAccumulator % SCROLL_ANGLE_THRESHOLD } };
  }
  return { delta: 0, newState: { lastAngle: angle, accumulator: newAccumulator } };
}

export function resetGesture(): WheelGestureState {
  return { lastAngle: null, accumulator: 0 };
}
