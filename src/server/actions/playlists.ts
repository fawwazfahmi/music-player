"use server";

import { db } from "@/server/db";

export async function getPlaylists() {
  return db.playlist.findMany({
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      coverImagePath: true,
      _count: { select: { tracks: true } },
    },
  });
}

export async function getPlaylistWithTracks(id: string) {
  const pl = await db.playlist.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      tracks: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          track: {
            select: {
              id: true,
              title: true,
              duration: true,
              primaryArtist: { select: { name: true } },
              album: { select: { title: true, coverArtPath: true } },
            },
          },
        },
      },
    },
  });
  if (!pl) return null;
  return { id: pl.id, name: pl.name, tracks: pl.tracks.map((t) => t.track) };
}

export async function createPlaylist(name: string): Promise<{ id: string }> {
  const count = await db.playlist.count();
  return db.playlist.create({
    data: { name, position: count },
    select: { id: true },
  });
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  await db.playlist.update({ where: { id }, data: { name } });
}

export async function deletePlaylist(id: string): Promise<void> {
  await db.playlist.delete({ where: { id } });
}

export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const existing = await db.playlistTrack.findUnique({
    where: { playlistId_trackId: { playlistId, trackId } },
  });
  if (existing) return;
  const last = await db.playlistTrack.findFirst({
    where: { playlistId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await db.playlistTrack.create({
    data: { playlistId, trackId, position: (last?.position ?? -1) + 1 },
  });
}

export async function removeFromPlaylist(
  playlistId: string,
  trackId: string,
): Promise<void> {
  await db.playlistTrack.delete({
    where: { playlistId_trackId: { playlistId, trackId } },
  });
}

export async function reorderPlaylist(
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  await db.$transaction(
    trackIds.map((trackId, position) =>
      db.playlistTrack.update({
        where: { playlistId_trackId: { playlistId, trackId } },
        data: { position },
      }),
    ),
  );
}
