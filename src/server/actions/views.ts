"use server";

import { db } from "@/server/db";

export async function getArtists() {
  return db.artist.findMany({
    orderBy: { sortName: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { tracks: true, albums: true } },
    },
  });
}

export async function getAlbumsByArtist(artistId: string) {
  return db.album.findMany({
    where: { artistId },
    orderBy: { releaseDate: "asc" },
    select: { id: true, title: true, coverArtPath: true, _count: { select: { tracks: true } } },
  });
}

export async function getAllAlbums() {
  return db.album.findMany({
    orderBy: [{ artist: { sortName: "asc" } }, { releaseDate: "asc" }],
    select: {
      id: true,
      title: true,
      coverArtPath: true,
      artist: { select: { id: true, name: true } },
    },
  });
}

export async function getAllSongs() {
  return db.track.findMany({
    where: { playable: true },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      duration: true,
      source: true,
      primaryArtist: { select: { id: true, name: true } },
      album: { select: { id: true, title: true, coverArtPath: true } },
    },
  });
}

export async function getTracksByAlbum(albumId: string) {
  return db.track.findMany({
    where: { albumId, playable: true },
    orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      trackNumber: true,
      source: true,
      primaryArtist: { select: { id: true, name: true } },
    },
  });
}

export async function getTracksByArtist(artistId: string) {
  return db.track.findMany({
    where: { primaryArtistId: artistId, playable: true },
    orderBy: [{ album: { releaseDate: "asc" } }, { trackNumber: "asc" }],
    select: {
      id: true,
      title: true,
      duration: true,
      source: true,
      album: { select: { id: true, title: true } },
    },
  });
}
