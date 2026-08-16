import type { QueueTrack } from "@/stores/player-store";

/**
 * Splice ephemeral YouTube picks into a library queue at random positions, so a
 * mood mix surfaces fresh picks inline rather than parking them in a side list.
 * Never inserts at index 0 — the first song stays a known library track for a
 * confident start. `rng` is injectable for deterministic tests.
 */
export function weaveEphemeral(
  base: QueueTrack[],
  picks: QueueTrack[],
  rng: () => number,
): QueueTrack[] {
  const out = [...base];
  for (const pick of picks) {
    // Insert somewhere in [1, out.length] (never at 0).
    const span = out.length; // number of valid insertion points at/after index 1
    const idx = 1 + Math.floor(rng() * span);
    out.splice(Math.min(idx, out.length), 0, pick);
  }
  return out;
}
