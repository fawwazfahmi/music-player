// When to surface the "Add it to Kyowave?" nudge for an ephemeral YouTube pick.
// Mirrors the mood nudge: ask only when it's worth asking — she's on an un-kept
// pick, hasn't decided, has heard most of it, and enough songs have passed since
// the last nudge that it doesn't nag.

export const ADOPT_NUDGE_PROGRESS = 0.6; // heard ≥60% of the pick
export const ADOPT_NUDGE_GAP = 3; // songs between nudges

export interface AdoptNudgeInput {
  isEphemeral: boolean;
  adopted: boolean;
  dismissed: boolean;
  progress: number; // 0..1 of the current track
  songsSinceNudge: number;
}

export function shouldShowAdoptNudge(i: AdoptNudgeInput): boolean {
  return (
    i.isEphemeral &&
    !i.adopted &&
    !i.dismissed &&
    i.progress >= ADOPT_NUDGE_PROGRESS &&
    i.songsSinceNudge >= ADOPT_NUDGE_GAP
  );
}
