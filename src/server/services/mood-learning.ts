import { db } from "@/server/db";
import { getAllMoods } from "@/server/services/mood-store";

export interface AffinityCounters {
  completes: number;
  skips: number;
  replays: number;
  thumbsUp: number;
  thumbsDown: number;
}

/** Derive a 0..1 learned affinity from raw counters. 0.5 = neutral; positive
    signal pushes toward 1, negative toward 0, with diminishing returns so one
    event doesn't swing it hard. This is the learned half of blendAffinity. */
export function computeLearnedScore(c: AffinityCounters): number {
  const positive = c.thumbsUp * 2 + c.completes * 1 + c.replays * 1.5;
  const negative = c.skips * 1 + c.thumbsDown * 2;
  const net = positive - negative;
  const K = 3;
  const score = 0.5 + 0.5 * (net / (Math.abs(net) + K));
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

export type MoodSignal = "complete" | "skip" | "replay" | "thumbUp" | "thumbDown" | "favorite";

const FIELD: Record<MoodSignal, keyof AffinityCounters> = {
  complete: "completes",
  skip: "skips",
  replay: "replays",
  thumbUp: "thumbsUp",
  favorite: "thumbsUp", // favoriting during a mood is a strong "this fits"
  thumbDown: "thumbsDown",
};

const EXPLICIT: Partial<Record<MoodSignal, "FIT" | "MISS">> = {
  thumbUp: "FIT",
  favorite: "FIT",
  thumbDown: "MISS",
};

/** Apply a learning signal for a track within a mood session. Updates the
    per-listener TrackMoodAffinity counters for every mood the session weighted,
    recomputes the derived score, and logs explicit verdicts to MoodFeedback.
    Best-effort and self-contained; safe to call fire-and-forget. */
export async function applyMoodSignal(params: {
  sessionId: string;
  trackId: string;
  signal: MoodSignal;
}): Promise<void> {
  const session = await db.moodSession.findUnique({
    where: { id: params.sessionId },
    select: { listener: true, interpretation: true },
  });
  if (!session) return;

  const interp = session.interpretation as { weights?: Record<string, number> } | null;
  const weights = interp?.weights ?? {};
  const moodNames = Object.entries(weights)
    .filter(([, w]) => typeof w === "number" && w > 0)
    .map(([name]) => name);
  if (moodNames.length === 0) return;

  const moods = await getAllMoods();
  const idByName = new Map(moods.map((m) => [m.name, m.id]));
  const field = FIELD[params.signal];
  const verdict = EXPLICIT[params.signal];

  for (const name of moodNames) {
    const moodId = idByName.get(name);
    if (!moodId) continue;

    await db.trackMoodAffinity.upsert({
      where: {
        listener_trackId_moodId: { listener: session.listener, trackId: params.trackId, moodId },
      },
      create: { listener: session.listener, trackId: params.trackId, moodId, [field]: 1 },
      update: { [field]: { increment: 1 } },
    });

    const row = await db.trackMoodAffinity.findUnique({
      where: {
        listener_trackId_moodId: { listener: session.listener, trackId: params.trackId, moodId },
      },
      select: {
        completes: true,
        skips: true,
        replays: true,
        thumbsUp: true,
        thumbsDown: true,
      },
    });
    if (row) {
      await db.trackMoodAffinity.update({
        where: {
          listener_trackId_moodId: {
            listener: session.listener,
            trackId: params.trackId,
            moodId,
          },
        },
        data: { score: computeLearnedScore(row) },
      });
    }
  }

  if (verdict) {
    await db.moodFeedback.create({
      data: { sessionId: params.sessionId, trackId: params.trackId, verdict },
    });
  }
}
