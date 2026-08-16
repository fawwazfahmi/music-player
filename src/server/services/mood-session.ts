import { db } from "@/server/db";
import { getAllMoods } from "@/server/services/mood-store";
import {
  interpretMood as ollamaInterpretMood,
  rerankByMood,
} from "@/server/services/mood-llm";
import { selectMoodTracks, type MoodPlaylistTrack } from "@/server/services/mood-engine";

export interface MoodSessionResult {
  sessionId: string;
  moodLabel: string;
  weights: Record<string, number>;
  genreHints: string[];
  tracks: MoodPlaylistTrack[];
}

export interface RunMoodSessionParams {
  listener: string;
  moodId?: string;
  freeText?: string;
  limit?: number;
  deps?: {
    interpretMood?: (
      freeText: string,
      moodNames: string[],
    ) => Promise<{ weights: Record<string, number>; genreHints: string[]; energy: unknown }>;
    rerank?: (
      moodLabel: string,
      candidates: { id: string; title: string; artist: string }[],
    ) => Promise<string[] | null>;
  };
}

/** Interpret the requested mood, select a library playlist, and persist the
    MoodSession (the context later feedback attaches to). Listener-explicit so
    it's testable; the server action supplies the listener from the cookie. */
export async function runMoodSession(params: RunMoodSessionParams): Promise<MoodSessionResult> {
  const interpret = params.deps?.interpretMood ?? ollamaInterpretMood;
  const rerank = params.deps?.rerank ?? rerankByMood;
  const moods = await getAllMoods();

  let weights: Record<string, number> = {};
  let genreHints: string[] = [];
  let moodLabel = "";
  let moodId: string | null = null;

  if (params.moodId) {
    const m = moods.find((x) => x.id === params.moodId);
    if (m) {
      weights = { [m.name]: 1 };
      moodLabel = m.label;
      moodId = m.id;
    }
  } else if (params.freeText && params.freeText.trim()) {
    const text = params.freeText.trim();
    const interp = await interpret(
      text,
      moods.map((m) => m.name),
    );
    weights = interp.weights;
    genreHints = interp.genreHints;
    moodLabel = text;
  }

  const tracks = await selectMoodTracks({
    listener: params.listener,
    weights,
    genreHints,
    limit: params.limit ?? 30,
    // Hybrid ranker: the formula shortlists, Ollama re-orders for nuance.
    moodLabel: moodLabel || "music",
    rerank,
  });

  const session = await db.moodSession.create({
    data: {
      listener: params.listener,
      moodId,
      freeText: params.freeText?.trim() || null,
      interpretation: { weights, genreHints },
    },
    select: { id: true },
  });

  return {
    sessionId: session.id,
    moodLabel: moodLabel || "For you",
    weights,
    genreHints,
    tracks,
  };
}
