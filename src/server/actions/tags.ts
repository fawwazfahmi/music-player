"use server";

import { db } from "@/server/db";

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
  trackCount: number;
}

export async function getAllTags(): Promise<TagSummary[]> {
  const tags = await db.tag.findMany({
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { tracks: true } },
    },
    orderBy: { name: "asc" },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    trackCount: t._count.tracks,
  }));
}

export async function getTagsForTrack(trackId: string): Promise<TagSummary[]> {
  const rows = await db.trackTag.findMany({
    where: { trackId },
    select: {
      tag: { select: { id: true, name: true, color: true } },
    },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((r) => ({
    id: r.tag.id,
    name: r.tag.name,
    color: r.tag.color,
    trackCount: 0,
  }));
}

export async function addTagToTrack(
  trackId: string,
  rawName: string,
): Promise<TagSummary | null> {
  const name = normalize(rawName);
  if (!name) return null;

  const tag = await db.tag.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true, name: true, color: true },
  });
  await db.trackTag.upsert({
    where: { trackId_tagId: { trackId, tagId: tag.id } },
    create: { trackId, tagId: tag.id },
    update: {},
  });
  return { ...tag, trackCount: 0 };
}

export async function removeTagFromTrack(trackId: string, tagId: string): Promise<void> {
  await db.trackTag
    .delete({ where: { trackId_tagId: { trackId, tagId } } })
    .catch(() => {
      /* idempotent */
    });
  // Garbage-collect tags that no longer belong to anything. Keeps the tag
  // autocomplete from surfacing stale options forever.
  const remaining = await db.trackTag.count({ where: { tagId } });
  if (remaining === 0) {
    await db.artistTag.count({ where: { tagId } }).then(async (a) => {
      const b = await db.albumTag.count({ where: { tagId } });
      if (a === 0 && b === 0) {
        await db.tag.delete({ where: { id: tagId } }).catch(() => {});
      }
    });
  }
}

export interface TaggedTrackSummary {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
  coverArtHash: string | null;
  ytVideoId: string | null;
}

export async function getTracksByTag(tagId: string): Promise<{
  tag: TagSummary | null;
  tracks: TaggedTrackSummary[];
}> {
  const tag = await db.tag.findUnique({
    where: { id: tagId },
    select: { id: true, name: true, color: true },
  });
  if (!tag) return { tag: null, tracks: [] };

  const rows = await db.trackTag.findMany({
    where: { tagId },
    select: {
      track: {
        select: {
          id: true,
          title: true,
          duration: true,
          ytVideoId: true,
          playable: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true, coverArtHash: true } },
        },
      },
    },
  });
  const tracks: TaggedTrackSummary[] = rows
    .filter((r) => r.track.playable)
    .map((r) => ({
      id: r.track.id,
      title: r.track.title,
      duration: r.track.duration,
      artist: r.track.primaryArtist.name,
      album: r.track.album?.title ?? "",
      coverArtHash: r.track.album?.coverArtHash ?? null,
      ytVideoId: r.track.ytVideoId ?? null,
    }));
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  return { tag: { ...tag, trackCount: tracks.length }, tracks };
}
