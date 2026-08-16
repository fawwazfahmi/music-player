// The fixed learning axes. Free-text moods are interpreted into a blend over
// these; feedback trains these. Shared by client (chips) and server (seeding).

export interface BuiltinMood {
  name: string; // normalized key
  label: string; // display label
  emoji: string;
  position: number;
}

export const BUILTIN_MOODS: BuiltinMood[] = [
  { name: "happy", label: "Happy", emoji: "😊", position: 0 },
  { name: "chill", label: "Chill", emoji: "😌", position: 1 },
  { name: "sad", label: "Sad", emoji: "😢", position: 2 },
  { name: "energetic", label: "Energetic", emoji: "⚡", position: 3 },
  { name: "focus", label: "Focus", emoji: "🎯", position: 4 },
  { name: "romantic", label: "Romantic", emoji: "💗", position: 5 },
  { name: "nostalgic", label: "Nostalgic", emoji: "🌇", position: 6 },
];

export const BUILTIN_MOOD_NAMES: string[] = BUILTIN_MOODS.map((m) => m.name);

export function normalizeMoodName(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Bound a weight/score to [0,1]; NaN → 0. */
export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 0;
  if (w < 0) return 0;
  if (w > 1) return 1;
  return w;
}

// Mood → genres that typically suit it. Used only as a cold-start fallback when
// Ollama is unavailable for seeding. Deliberately broad, not exhaustive.
const MOOD_GENRES: Record<string, string[]> = {
  happy: ["pop", "disco", "funk", "k-pop", "j-pop", "dance-pop", "dance"],
  chill: [
    "lo-fi", "lofi", "ambient", "chillout", "dream pop", "bedroom pop", "acoustic",
    "soft rock", "easy listening", "lounge", "jazz", "shoegaze",
  ],
  sad: ["blues", "ballad", "shoegaze", "slowcore", "emo", "soul"],
  energetic: [
    "metal", "heavy metal", "thrash metal", "speed metal", "power metal", "punk",
    "punk rock", "hard rock", "rock", "dance", "dance-pop", "edm", "electronic",
    "phonk", "phonk house", "hip hop", "rap", "pop rap", "disco", "funk",
  ],
  focus: ["ambient", "classical", "instrumental", "lo-fi", "lofi", "jazz"],
  romantic: ["r&b", "contemporary r&b", "neo soul", "soul", "jazz pop", "ballad"],
  nostalgic: [
    "classic rock", "synth-pop", "new wave", "dark wave", "swing", "big band",
    "dixieland", "oldies", "disco",
  ],
};

/** Cold-start mood scores derived purely from a track's genres. Returns only
    moods present in `moodNames`. Each matched mood gets a modest 0.6 so a real
    LLM/learned signal outweighs it later. */
export function genreMoodHeuristic(
  genres: string[],
  moodNames: string[],
): Record<string, number> {
  const known = new Set(moodNames);
  const g = new Set(genres.map((x) => x.trim().toLowerCase()));
  const out: Record<string, number> = {};
  for (const [mood, list] of Object.entries(MOOD_GENRES)) {
    if (!known.has(mood)) continue;
    if (list.some((x) => g.has(x))) out[mood] = 0.6;
  }
  return out;
}
