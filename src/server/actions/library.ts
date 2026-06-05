"use server";

import { rm } from "node:fs/promises";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { scanOnce, type ScanReport } from "@/server/services/library-scanner";

export async function rescanLibrary(): Promise<ScanReport> {
  return scanOnce(env.MUSIC_LIBRARY_PATH);
}

export interface DeleteTrackResult {
  removedTrack: boolean;
  removedFile: boolean;
  removedArtist: boolean;
  removedAlbum: boolean;
}

/**
 * Permanently remove a track from the library: deletes the audio file from
 * disk (so the library scanner won't re-import it), wipes the Track row
 * (cascading TrackArtist / TrackTag / SongNote / ListeningHistory / playlist
 * entries / favorites / external IDs / YtCacheEntry), and cleans up the
 * primary artist and album if no other tracks reference them.
 */
export async function deleteTrack(trackId: string): Promise<DeleteTrackResult> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      filePath: true,
      primaryArtistId: true,
      albumId: true,
    },
  });
  if (!track) return { removedTrack: false, removedFile: false, removedArtist: false, removedAlbum: false };

  let removedFile = false;
  if (track.filePath) {
    try {
      await rm(track.filePath, { force: true });
      removedFile = true;
    } catch {
      // File may already be gone; don't block the DB cleanup.
    }
  }

  await db.track.delete({ where: { id: trackId } });

  // Orphan cleanup. Artist/Album have onDelete: Cascade upward (i.e. deleting
  // them wipes their tracks), so we only delete when nothing remains.
  let removedArtist = false;
  const artistTracks = await db.track.count({ where: { primaryArtistId: track.primaryArtistId } });
  if (artistTracks === 0) {
    await db.artist.delete({ where: { id: track.primaryArtistId } }).then(() => {
      removedArtist = true;
    }).catch(() => {});
  }

  let removedAlbum = false;
  if (track.albumId) {
    const albumTracks = await db.track.count({ where: { albumId: track.albumId } });
    if (albumTracks === 0) {
      await db.album.delete({ where: { id: track.albumId } }).then(() => {
        removedAlbum = true;
      }).catch(() => {});
    }
  }

  return { removedTrack: true, removedFile, removedArtist, removedAlbum };
}

export async function backfillMetadata(): Promise<{ enqueued: number }> {
  const pendingTrackIds = new Set(
    (
      await db.metadataJob.findMany({
        where: { status: { in: ["QUEUED", "RUNNING"] }, trackId: { not: null } },
        select: { trackId: true },
      })
    )
      .map((j) => j.trackId)
      .filter((id): id is string => id !== null),
  );
  const tracks = await db.track.findMany({
    where: { metadataFetched: null },
    select: { id: true },
  });
  const toEnqueue = tracks.filter((t) => !pendingTrackIds.has(t.id));
  if (toEnqueue.length === 0) return { enqueued: 0 };
  await db.metadataJob.createMany({
    data: toEnqueue.map((t) => ({ entityType: "TRACK" as const, trackId: t.id, status: "QUEUED" as const })),
  });
  return { enqueued: toEnqueue.length };
}
