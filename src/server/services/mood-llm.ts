import { env } from "@/lib/env";
import { normalizeGenre } from "@/lib/genre";

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
