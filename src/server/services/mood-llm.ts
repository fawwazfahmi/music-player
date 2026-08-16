import { env } from "@/lib/env";
import { normalizeGenre } from "@/lib/genre";
import { clampWeight } from "@/lib/moods";

const TIMEOUT_MS = 20_000;

/** POST a prompt to Ollama and parse the model's reply as JSON. Returns null on
    any failure — network, non-200, timeout, or a reply that isn't valid JSON —
    so callers can degrade gracefully. Ollama is never a hard dependency. */
export async function ollamaGenerateJson<T>(prompt: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    return JSON.parse(data.response) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cold-start genre guess from title + artist, for tracks MusicBrainz can't
    resolve (e.g. YouTube downloads). Returns 0–3 normalized genre names, or []
    when Ollama is unavailable or unsure. */
export async function classifyGenre(input: { title: string; artist: string }): Promise<string[]> {
  const prompt =
    `You label a song with music genres. Respond ONLY with JSON of the form ` +
    `{"genres": ["genre1", "genre2"]}. Use 1-3 common, broad genres (e.g. pop, ` +
    `rock, hip hop, r&b, jazz, electronic, indie, classical, country, k-pop). ` +
    `If unsure, return {"genres": []}.\n` +
    `Song: "${input.title}" by "${input.artist}".`;

  const parsed = await ollamaGenerateJson<{ genres?: unknown }>(prompt);
  if (!parsed || !Array.isArray(parsed.genres)) return [];
  const cleaned = parsed.genres
    .filter((g): g is string => typeof g === "string")
    .map((g) => normalizeGenre(g))
    .filter((g) => g.length > 0);
  return Array.from(new Set(cleaned)).slice(0, 3);
}

export type MoodEnergy = "low" | "medium" | "high";

export interface MoodInterpretation {
  weights: Record<string, number>; // mood name -> 0..1, only known moods
  genreHints: string[];
  energy: MoodEnergy | null;
}

// Keyword fallback so free text still resolves to a mood when Ollama is down.
const MOOD_KEYWORDS: Record<string, string[]> = {
  happy: ["happy", "joy", "joyful", "upbeat", "sunny", "cheer", "good mood", "feelgood"],
  chill: ["chill", "relax", "calm", "lofi", "lo-fi", "rainy", "sunday", "lazy", "mellow", "sleep"],
  sad: ["sad", "cry", "crying", "lonely", "heartbreak", "heartbroken", "down", "blue", "miss", "tears"],
  energetic: ["gym", "workout", "energetic", "hype", "party", "dance", "run", "running", "pump", "hyped"],
  focus: ["focus", "study", "studying", "work", "working", "concentrate", "coding", "deep work", "reading"],
  romantic: ["romantic", "love", "date", "crush", "cuddle", "valentine"],
  nostalgic: ["nostalgic", "nostalgia", "memories", "throwback", "childhood", "old days", "reminisce"],
};

function keywordWeights(text: string, moodNames: string[]): Record<string, number> {
  const lower = text.toLowerCase();
  const known = new Set(moodNames);
  const weights: Record<string, number> = {};
  for (const [mood, words] of Object.entries(MOOD_KEYWORDS)) {
    if (!known.has(mood)) continue;
    if (words.some((w) => lower.includes(w))) weights[mood] = 1;
  }
  return weights;
}

function pickKnownWeights(
  raw: Record<string, unknown> | undefined,
  moodNames: string[],
): Record<string, number> {
  const known = new Set(moodNames);
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, val] of Object.entries(raw)) {
    const key = name.trim().toLowerCase();
    if (!known.has(key)) continue;
    if (typeof val !== "number") continue;
    out[key] = clampWeight(val);
  }
  return out;
}

/** Interpret a free-text mood into a blend over the known built-in moods, plus
    optional genre/energy hints. Falls back to keyword matching when Ollama is
    unavailable; returns empty weights when nothing matches. */
export async function interpretMood(
  freeText: string,
  moodNames: string[],
): Promise<MoodInterpretation> {
  const prompt =
    `Map how someone feels to music moods. Known moods: ${moodNames.join(", ")}. ` +
    `Respond ONLY with JSON: {"moods": {"<mood>": <0..1>}, "genreHints": ["..."], ` +
    `"energy": "low"|"medium"|"high"}. Use only the known moods; weight each by how ` +
    `strongly it fits. genreHints are optional music genres that suit this feeling.\n` +
    `Feeling: "${freeText}".`;

  const parsed = await ollamaGenerateJson<{
    moods?: Record<string, unknown>;
    genreHints?: unknown;
    energy?: unknown;
  }>(prompt);

  let weights: Record<string, number>;
  let genreHints: string[] = [];
  let energy: MoodEnergy | null = null;

  if (parsed) {
    weights = pickKnownWeights(parsed.moods, moodNames);
    if (Array.isArray(parsed.genreHints)) {
      genreHints = parsed.genreHints
        .filter((g): g is string => typeof g === "string")
        .map((g) => normalizeGenre(g))
        .filter((g) => g.length > 0);
    }
    if (parsed.energy === "low" || parsed.energy === "medium" || parsed.energy === "high") {
      energy = parsed.energy;
    }
  } else {
    weights = {};
  }

  // If the LLM gave nothing usable, try keywords.
  if (Object.keys(weights).length === 0) {
    weights = keywordWeights(freeText, moodNames);
  }

  return { weights, genreHints, energy };
}

/** Cold-start per-mood affinity scores (0..1) for a track, from its title,
    artist, and any known genres. Returns only known moods; {} when Ollama is
    unavailable. */
export async function seedTrackMoods(
  input: { title: string; artist: string; genres: string[] },
  moodNames: string[],
): Promise<Record<string, number>> {
  const genrePart = input.genres.length > 0 ? ` Genres: ${input.genres.join(", ")}.` : "";
  const prompt =
    `Rate how well a song fits each mood. Known moods: ${moodNames.join(", ")}. ` +
    `Respond ONLY with JSON: {"moods": {"<mood>": <0..1>}}. Score every mood that ` +
    `applies (0 = not at all, 1 = perfect). Only use the known moods.\n` +
    `Song: "${input.title}" by "${input.artist}".${genrePart}`;

  const parsed = await ollamaGenerateJson<{ moods?: Record<string, unknown> }>(prompt);
  if (!parsed) return {};
  return pickKnownWeights(parsed.moods, moodNames);
}
