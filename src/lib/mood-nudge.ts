// When to surface the "was this a <mood> vibe?" nudge. Deliberately asks only
// when the answer is worth having: she's in a mood session, on a track that
// belongs to it, hasn't rated it, has heard most of it (so she has an opinion),
// and enough songs have passed since the last nudge that it doesn't nag.

export const NUDGE_PROGRESS = 0.6; // heard ≥60% of the song
export const NUDGE_GAP = 3; // songs between nudges

export interface NudgeInput {
  inSession: boolean;
  belongs: boolean;
  reacted: boolean;
  progress: number; // 0..1 of the current track
  songsSinceNudge: number;
}

export function shouldShowNudge(i: NudgeInput): boolean {
  return (
    i.inSession &&
    i.belongs &&
    !i.reacted &&
    i.progress >= NUDGE_PROGRESS &&
    i.songsSinceNudge >= NUDGE_GAP
  );
}
