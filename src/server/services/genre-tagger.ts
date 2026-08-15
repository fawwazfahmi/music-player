import { db } from "@/server/db";
import { getGenres } from "@/server/services/musicbrainz";
import { classifyGenre as ollamaClassifyGenre } from "@/server/services/mood-llm";

const MAX_GENRES = 3;

export interface GenreTaggerDeps {
  fetchMbGenres?: (entityType: "recording" | "artist", mbid: string) => Promise<string[]>;
  classifyGenre?: (input: { title: string; artist: string }) => Promise<string[]>;
}

/** Resolve and persist genres for one track. MusicBrainz first (recording, then
    artist), Ollama as cold-start fallback. Idempotent: a track that already has
    genres is left alone. Returns the normalized genre names applied this run
    ([] when nothing was added). Never throws MB/Ollama failures to the caller. */
export async function tagTrackGenres(
  trackId: string,
  deps: GenreTaggerDeps = {},
): Promise<string[]> {
  const fetchMbGenres = deps.fetchMbGenres ?? getGenres;
  const classifyGenre = deps.classifyGenre ?? ollamaClassifyGenre;

  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      mbid: true,
      primaryArtistId: true,
      primaryArtist: { select: { id: true, name: true, mbid: true } },
      _count: { select: { genres: true } },
    },
  });
  if (!track) return [];
  if (track._count.genres > 0) return []; // already tagged

  let names: string[] = [];
  let fromArtist = false;

  // 1) recording-level MB genres
  if (track.mbid) {
    names = await safe(() => fetchMbGenres("recording", track.mbid!));
  }
  // 2) artist-level MB genres
  if (names.length === 0 && track.primaryArtist.mbid) {
    names = await safe(() => fetchMbGenres("artist", track.primaryArtist.mbid!));
    if (names.length > 0) fromArtist = true;
  }
  // 3) Ollama cold-start
  if (names.length === 0) {
    names = await safe(() =>
      classifyGenre({ title: track.title, artist: track.primaryArtist.name }),
    );
  }

  names = dedupe(names).slice(0, MAX_GENRES);
  if (names.length === 0) return [];

  for (const name of names) {
    const genre = await db.genre.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    });
    await db.trackGenre.upsert({
      where: { trackId_genreId: { trackId, genreId: genre.id } },
      create: { trackId, genreId: genre.id },
      update: {},
    });
    if (fromArtist) {
      await db.artistGenre.upsert({
        where: { artistId_genreId: { artistId: track.primaryArtistId, genreId: genre.id } },
        create: { artistId: track.primaryArtistId, genreId: genre.id },
        update: {},
      });
    }
  }
  return names;
}

async function safe(fn: () => Promise<string[]>): Promise<string[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.filter((x) => x.length > 0)));
}
