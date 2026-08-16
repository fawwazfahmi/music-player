import { db } from "@/server/db";
import { tagTrackGenres } from "@/server/services/genre-tagger";
import { analyzeTrackFile, storeAudioFeatures } from "@/server/services/audio-analysis";
import { seedTrackMoodAffinities } from "@/server/services/mood-seeder";
import { applyCleanMeta } from "@/server/services/title-cleaner";

export interface EnrichExtrasDeps {
  cleanMeta?: (trackId: string) => Promise<unknown>;
  tagGenres?: (trackId: string) => Promise<unknown>;
  analyzeFile?: (filePath: string) => Promise<Awaited<ReturnType<typeof analyzeTrackFile>>>;
  storeFeatures?: (trackId: string, feats: NonNullable<Awaited<ReturnType<typeof analyzeTrackFile>>>) => Promise<void>;
  seedMoods?: (trackId: string, opts: { force?: boolean }) => Promise<unknown>;
  getFilePath?: (trackId: string) => Promise<string | null>;
}

/**
 * Genre + audio + mood enrichment for a track, independent of MusicBrainz.
 *
 * Order matters: genres and audio features are gathered first so the mood seed
 * can use them. Each step is best-effort — a failure in one never blocks the
 * others. Runs from the metadata worker (regardless of MB match) and again
 * after a YouTube download finalizes (when the audio file is finally present),
 * so every track — matched or not — gets the full treatment.
 */
export async function enrichTrackExtras(
  trackId: string,
  opts: { force?: boolean; deps?: EnrichExtrasDeps } = {},
): Promise<void> {
  const d = opts.deps ?? {};
  const cleanMeta = d.cleanMeta ?? ((id: string) => applyCleanMeta(id));
  const tagGenres = d.tagGenres ?? tagTrackGenres;
  const analyzeFile = d.analyzeFile ?? analyzeTrackFile;
  const storeFeatures = d.storeFeatures ?? storeAudioFeatures;
  const seedMoods = d.seedMoods ?? seedTrackMoodAffinities;
  const getFilePath =
    d.getFilePath ??
    (async (id: string) =>
      (await db.track.findUnique({ where: { id }, select: { filePath: true } }))?.filePath ?? null);

  // First: clean the title/artist/album from grounded sources (yt-dlp metadata,
  // description credits, deterministic tidy). Everything below — genres, mood —
  // then keys off the corrected title/artist, so a new add is never tagged
  // against a garbled "H o m e (S l o w e d)" string.
  try {
    await cleanMeta(trackId);
  } catch (err) {
    console.warn("[mu] title cleaning failed:", err);
  }

  try {
    await tagGenres(trackId);
  } catch (err) {
    console.warn("[mu] genre tagging failed:", err);
  }

  try {
    const filePath = await getFilePath(trackId);
    if (filePath) {
      const feats = await analyzeFile(filePath);
      if (feats) await storeFeatures(trackId, feats);
    }
  } catch (err) {
    console.warn("[mu] audio analysis failed:", err);
  }

  try {
    await seedMoods(trackId, { force: opts.force });
  } catch (err) {
    console.warn("[mu] mood seeding failed:", err);
  }
}
