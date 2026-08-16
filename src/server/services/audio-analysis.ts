import { execFile } from "node:child_process";
import path from "node:path";
import { db } from "@/server/db";

export interface RawAudioFeatures {
  mood_happy?: number;
  mood_sad?: number;
  mood_relaxed?: number;
  mood_aggressive?: number;
  mood_party?: number;
  danceability?: number;
  danceability_dsp?: number;
  tempo?: number | null;
  key?: string;
  scale?: string;
  key_strength?: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Map pre-trained model outputs onto our mood axes. Audio is confident about
    happy/sad/chill/energetic/focus; romantic/nostalgic are left to the LLM +
    lyrics, so they're intentionally absent here. */
export function audioMoodScores(f: RawAudioFeatures): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof f.mood_happy === "number") out.happy = clamp01(f.mood_happy);
  if (typeof f.mood_sad === "number") out.sad = clamp01(f.mood_sad);
  if (typeof f.mood_relaxed === "number") out.chill = clamp01(f.mood_relaxed);

  const dance = f.danceability ?? 0;
  const aggr = f.mood_aggressive ?? 0;
  const party = f.mood_party ?? 0;
  if (
    typeof f.danceability === "number" ||
    typeof f.mood_aggressive === "number" ||
    typeof f.mood_party === "number"
  ) {
    out.energetic = clamp01(0.4 * dance + 0.3 * aggr + 0.3 * party);
  }
  if (typeof f.mood_relaxed === "number" && typeof f.danceability === "number") {
    out.focus = clamp01(f.mood_relaxed * (1 - f.danceability));
  }
  return out;
}

/** Blend LLM/lyrics seed scores with audio-derived scores. Audio is weighted
    higher where both exist ("hearing the song"), but the LLM still contributes
    nuance and covers moods audio can't judge. */
export function blendSeedScores(
  llm: Record<string, number>,
  audio: Record<string, number>,
): Record<string, number> {
  const names = new Set([...Object.keys(llm), ...Object.keys(audio)]);
  const out: Record<string, number> = {};
  for (const m of names) {
    const l = llm[m];
    const a = audio[m];
    let v: number;
    if (typeof l === "number" && typeof a === "number") v = 0.6 * a + 0.4 * l;
    else v = (a ?? l) as number;
    out[m] = clamp01(v);
  }
  return out;
}

export interface AudioAnalysisDeps {
  runAnalyzer?: (filePath: string) => Promise<RawAudioFeatures | null>;
}

const PY = process.env.AUDIO_ANALYZER_PY ?? path.join(process.cwd(), ".venv-audio", "bin", "python");
const SCRIPT = path.join(process.cwd(), "scripts", "audio", "extract_features.py");

/** Run the Essentia pipeline on a single local file. Returns null on any
    failure (missing venv/models, unreadable file). Never throws. */
export function analyzeTrackFile(filePath: string): Promise<RawAudioFeatures | null> {
  return new Promise((resolve) => {
    execFile(
      PY,
      [SCRIPT, filePath],
      { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout) => {
        const line = (stdout ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .pop();
        if (!line) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(line) as {
            ok?: boolean;
            features?: RawAudioFeatures;
          };
          resolve(parsed.ok && parsed.features ? parsed.features : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/** Persist raw features for a track (upsert). */
export async function storeAudioFeatures(trackId: string, f: RawAudioFeatures): Promise<void> {
  const data = {
    moodHappy: f.mood_happy ?? null,
    moodSad: f.mood_sad ?? null,
    moodRelaxed: f.mood_relaxed ?? null,
    moodAggressive: f.mood_aggressive ?? null,
    moodParty: f.mood_party ?? null,
    danceability: f.danceability ?? null,
    danceabilityDsp: f.danceability_dsp ?? null,
    tempo: typeof f.tempo === "number" ? f.tempo : null,
    musicalKey: f.key ?? null,
    scale: f.scale ?? null,
    keyStrength: f.key_strength ?? null,
  };
  await db.trackAudioFeatures.upsert({
    where: { trackId },
    create: { trackId, ...data },
    update: data,
  });
}

/** Load stored features for a track as raw values (for the seeder). */
export async function loadAudioFeatures(trackId: string): Promise<RawAudioFeatures | null> {
  const r = await db.trackAudioFeatures.findUnique({ where: { trackId } });
  if (!r) return null;
  return {
    mood_happy: r.moodHappy ?? undefined,
    mood_sad: r.moodSad ?? undefined,
    mood_relaxed: r.moodRelaxed ?? undefined,
    mood_aggressive: r.moodAggressive ?? undefined,
    mood_party: r.moodParty ?? undefined,
    danceability: r.danceability ?? undefined,
    danceability_dsp: r.danceabilityDsp ?? undefined,
    tempo: r.tempo ?? undefined,
    key: r.musicalKey ?? undefined,
    scale: r.scale ?? undefined,
    key_strength: r.keyStrength ?? undefined,
  };
}
