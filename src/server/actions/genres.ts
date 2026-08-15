"use server";

import { db } from "@/server/db";
import { resolveTrackCoverHash } from "@/lib/cover-url";
import { normalizeGenre } from "@/lib/genre";

export interface GenreSummary {
  id: string;
  name: string;
  trackCount: number;
}

export interface GenreTrackSummary {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtHash: string | null;
  ytVideoId: string | null;
}

export async function getAllGenres(): Promise<GenreSummary[]> {
  const genres = await db.genre.findMany({
    select: { id: true, name: true, _count: { select: { tracks: true } } },
    orderBy: { name: "asc" },
  });
  return genres
    .map((g) => ({ id: g.id, name: g.name, trackCount: g._count.tracks }))
    .filter((g) => g.trackCount > 0);
}

export async function getGenresForTrack(trackId: string): Promise<GenreSummary[]> {
  const rows = await db.trackGenre.findMany({
    where: { trackId },
    select: { genre: { select: { id: true, name: true } } },
    orderBy: { genre: { name: "asc" } },
  });
  return rows.map((r) => ({ id: r.genre.id, name: r.genre.name, trackCount: 0 }));
}

export async function addGenreToTrack(
  trackId: string,
  rawName: string,
): Promise<GenreSummary | null> {
  const name = normalizeGenre(rawName);
  if (!name) return null;

  const genre = await db.genre.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true, name: true },
  });
  await db.trackGenre.upsert({
    where: { trackId_genreId: { trackId, genreId: genre.id } },
    create: { trackId, genreId: genre.id },
    update: {},
  });
  return { ...genre, trackCount: 0 };
}

export async function removeGenreFromTrack(trackId: string, genreId: string): Promise<void> {
  await db.trackGenre
    .delete({ where: { trackId_genreId: { trackId, genreId } } })
    .catch(() => {
      /* idempotent */
    });
  // Garbage-collect a genre that no longer labels any track, artist, or album,
  // so the browse grid never shows an empty genre. Mirrors tags.ts.
  const [tracks, artists, albums] = await Promise.all([
    db.trackGenre.count({ where: { genreId } }),
    db.artistGenre.count({ where: { genreId } }),
    db.albumGenre.count({ where: { genreId } }),
  ]);
  if (tracks === 0 && artists === 0 && albums === 0) {
    await db.genre.delete({ where: { id: genreId } }).catch(() => {});
  }
}

export async function getTracksByGenre(genreId: string): Promise<{
  genre: GenreSummary | null;
  tracks: GenreTrackSummary[];
}> {
  const genre = await db.genre.findUnique({
    where: { id: genreId },
    select: { id: true, name: true },
  });
  if (!genre) return { genre: null, tracks: [] };

  const rows = await db.trackGenre.findMany({
    where: { genreId },
    select: {
      track: {
        select: {
          id: true,
          title: true,
          duration: true,
          coverArtHash: true,
          ytVideoId: true,
          playable: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true, coverArtHash: true } },
        },
      },
    },
  });
  const tracks: GenreTrackSummary[] = rows
    .filter((r) => r.track.playable)
    .map((r) => ({
      id: r.track.id,
      title: r.track.title,
      duration: r.track.duration,
      artist: r.track.primaryArtist.name,
      album: r.track.album?.title ?? "",
      coverArtHash: resolveTrackCoverHash({
        trackCoverArtHash: r.track.coverArtHash,
        albumCoverArtHash: r.track.album?.coverArtHash,
      }),
      ytVideoId: r.track.ytVideoId ?? null,
    }));
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  return { genre: { ...genre, trackCount: tracks.length }, tracks };
}
