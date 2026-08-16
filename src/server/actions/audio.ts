"use server";

import { db } from "@/server/db";

export interface AudioFeaturesView {
  tempo: number | null;
  key: string | null;
  scale: string | null;
  danceability: number | null;
  moods: { label: string; value: number }[];
}

export async function getTrackAudioFeatures(trackId: string): Promise<AudioFeaturesView | null> {
  const r = await db.trackAudioFeatures.findUnique({ where: { trackId } });
  if (!r) return null;
  const moods = [
    { label: "Happy", value: r.moodHappy },
    { label: "Sad", value: r.moodSad },
    { label: "Relaxed", value: r.moodRelaxed },
    { label: "Aggressive", value: r.moodAggressive },
    { label: "Party", value: r.moodParty },
  ].filter((m): m is { label: string; value: number } => typeof m.value === "number");
  return {
    tempo: r.tempo,
    key: r.musicalKey,
    scale: r.scale,
    danceability: r.danceability,
    moods,
  };
}
