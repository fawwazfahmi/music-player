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
