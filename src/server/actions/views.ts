"use server";

import { db } from "@/server/db";
import { coverUrl, resolveTrackCoverHash } from "@/lib/cover-url";

// A track that carries *some* art, used to give artists/albums a representative
// image when they have none of their own. Prefer real cover art; YT thumbnail
// is the last resort.
const repTrackSelect = {
  where: {
    inLibrary: true,
    OR: [
      { coverArtHash: { not: null } },
      { album: { coverArtHash: { not: null } } },
      { ytVideoId: { not: null } },
    ],
  },
  take: 1,
  select: {
    coverArtHash: true,
    ytVideoId: true,
    album: { select: { coverArtHash: true } },
  },
};

function repImage(
  t:
    | { coverArtHash: string | null; ytVideoId: string | null; album: { coverArtHash: string | null } | null }
    | undefined,
): string | null {
  if (!t) return null;
  return coverUrl(
    resolveTrackCoverHash({ trackCoverArtHash: t.coverArtHash, albumCoverArtHash: t.album?.coverArtHash }),
    t.ytVideoId,
  );
}

export async function getArtists() {
  const artists = await db.artist.findMany({
    // Hide artists whose only tracks are ephemeral "trying it out" picks.
    where: { tracks: { some: { inLibrary: true } } },
    orderBy: { sortName: "asc" },
    select: {
      id: true,
      name: true,
      bio: true,
      _count: { select: { tracks: { where: { inLibrary: true } }, albums: true } },
      tracks: repTrackSelect,
    },
  });
  return artists.map(({ tracks, ...a }) => ({ ...a, imageUrl: repImage(tracks[0]) }));
}

export async function getAlbumsByArtist(artistId: string) {
  const albums = await db.album.findMany({
    where: { artistId },
    orderBy: { releaseDate: "asc" },
    select: {
      id: true,
      title: true,
      coverArtPath: true,
      coverArtHash: true,
      _count: { select: { tracks: true } },
      tracks: repTrackSelect,
    },
  });
  return albums.map(({ tracks, ...a }) => ({
    ...a,
    imageUrl: a.coverArtHash ? coverUrl(a.coverArtHash) : repImage(tracks[0]),
  }));
}

export async function getAllAlbums() {
  const albums = await db.album.findMany({
    // Hide albums whose only tracks are ephemeral picks (e.g. a per-artist
    // "YouTube" album that exists only because of a not-yet-adopted try).
    where: { tracks: { some: { inLibrary: true } } },
    orderBy: [{ artist: { sortName: "asc" } }, { releaseDate: "asc" }],
    select: {
      id: true,
      title: true,
      coverArtPath: true,
      coverArtHash: true,
      artist: { select: { id: true, name: true } },
      tracks: repTrackSelect,
    },
  });
  return albums.map(({ tracks, ...a }) => ({
    ...a,
    imageUrl: a.coverArtHash ? coverUrl(a.coverArtHash) : repImage(tracks[0]),
  }));
}

export async function getAllSongs() {
  const t0 = Date.now();
  const rows = await db.track.findMany({
    where: { playable: true, inLibrary: true },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      duration: true,
      coverArtHash: true,
      source: true,
      ytVideoId: true,
      primaryArtist: { select: { id: true, name: true } },
      album: { select: { id: true, title: true, coverArtPath: true, coverArtHash: true } },
    },
  });
  console.log(`[mu] getAllSongs → ${rows.length} rows in ${Date.now() - t0}ms`);
  return rows;
}

export async function getTracksByAlbum(albumId: string) {
  return db.track.findMany({
    where: { albumId, playable: true, inLibrary: true },
    orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      coverArtHash: true,
      trackNumber: true,
      source: true,
      ytVideoId: true,
      primaryArtist: { select: { id: true, name: true } },
    },
  });
}

export async function getTracksByArtist(artistId: string) {
  return db.track.findMany({
    where: { primaryArtistId: artistId, playable: true, inLibrary: true },
    orderBy: [{ album: { releaseDate: "asc" } }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      coverArtHash: true,
      source: true,
      ytVideoId: true,
      album: { select: { id: true, title: true, coverArtHash: true } },
    },
  });
}
