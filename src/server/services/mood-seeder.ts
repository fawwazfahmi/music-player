import { db } from "@/server/db";
import { getAllMoods } from "@/server/services/mood-store";
import { seedTrackMoods as ollamaSeedTrackMoods } from "@/server/services/mood-llm";
import { genreMoodHeuristic } from "@/lib/moods";

const MIN_SCORE = 0.05; // below this, not worth storing

export interface MoodSeederDeps {
  seedTrackMoods?: (
    input: { title: string; artist: string; genres: string[] },
    moodNames: string[],
  ) => Promise<Record<string, number>>;
}

/** Seed a track's listener-agnostic baseline mood affinities (TrackMoodSeed).
    Ollama first, genre heuristic as fallback. Idempotent: a track that already
    has seeds is left alone. Returns the mood names seeded ([] when none). Never
    throws Ollama failures to the caller. */
export async function seedTrackMoodAffinities(
  trackId: string,
  deps: MoodSeederDeps = {},
): Promise<string[]> {
  const seedFn = deps.seedTrackMoods ?? ollamaSeedTrackMoods;

  const existing = await db.trackMoodSeed.count({ where: { trackId } });
  if (existing > 0) return [];

  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      title: true,
      primaryArtist: { select: { name: true } },
      genres: { select: { genre: { select: { name: true } } } },
    },
  });
  if (!track) return [];

  const genres = track.genres.map((g) => g.genre.name);
  const moods = await getAllMoods();
  const moodNames = moods.map((m) => m.name);
  const idByName = new Map(moods.map((m) => [m.name, m.id]));

  let scores: Record<string, number> = {};
  let source: "LLM_SEED" | "HEURISTIC" = "LLM_SEED";
  try {
    scores = await seedFn(
      { title: track.title, artist: track.primaryArtist.name, genres },
      moodNames,
    );
  } catch {
    scores = {};
  }
  // Fall back to the genre heuristic when the LLM gives nothing USABLE — an
  // all-zero dict (model unsure) counts as nothing, not as a real answer.
  let usable = Object.entries(scores).filter(([, s]) => s >= MIN_SCORE);
  if (usable.length === 0) {
    scores = genreMoodHeuristic(genres, moodNames);
    usable = Object.entries(scores).filter(([, s]) => s >= MIN_SCORE);
    source = "HEURISTIC";
  }

  const applied: string[] = [];
  for (const [name, score] of usable) {
    const moodId = idByName.get(name);
    if (!moodId) continue;
    await db.trackMoodSeed.upsert({
      where: { trackId_moodId: { trackId, moodId } },
      create: { trackId, moodId, score, source },
      update: {}, // idempotent — never clobber existing
    });
    applied.push(name);
  }
  return applied;
}
