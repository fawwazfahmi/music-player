"use server";

import { db } from "@/server/db";

export type StatsRange = "7d" | "30d" | "365d" | "all";

function sinceFor(range: StatsRange): Date | undefined {
  const now = Date.now();
  switch (range) {
    case "7d":
      return new Date(now - 7 * 86400_000);
    case "30d":
      return new Date(now - 30 * 86400_000);
    case "365d":
      return new Date(now - 365 * 86400_000);
    case "all":
      return undefined;
  }
}

// A "real" play is one where the user listened to at least 80% of the track,
// the same threshold used elsewhere to set `completed`. This filters out skips.
const COMPLETED_ONLY = { completed: true } as const;

export interface TopTrack {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverArtHash: string | null;
  duration: number;
  ytVideoId: string | null;
  playCount: number;
}

export async function getTopTracks(range: StatsRange, limit = 50): Promise<TopTrack[]> {
  const since = sinceFor(range);
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: {
      ...COMPLETED_ONLY,
      ...(since ? { playedAt: { gte: since } } : {}),
    },
    _count: { _all: true },
    orderBy: { _count: { trackId: "desc" } },
    take: limit,
  });

  if (rows.length === 0) return [];

  const tracks = await db.track.findMany({
    where: { id: { in: rows.map((r) => r.trackId) } },
    select: {
      id: true,
      title: true,
      duration: true,
      ytVideoId: true,
      primaryArtist: { select: { name: true } },
      album: { select: { title: true, coverArtHash: true } },
    },
  });
  const byId = new Map(tracks.map((t) => [t.id, t]));

  return rows
    .map((r) => {
      const t = byId.get(r.trackId);
      if (!t) return null;
      return {
        trackId: t.id,
        title: t.title,
        artist: t.primaryArtist.name,
        album: t.album?.title ?? "",
        coverArtHash: t.album?.coverArtHash ?? null,
        duration: t.duration,
        ytVideoId: t.ytVideoId ?? null,
        playCount: r._count._all,
      };
    })
    .filter((x): x is TopTrack => x !== null);
}

export interface TopArtist {
  artistId: string;
  name: string;
  playCount: number;
}

export async function getTopArtists(range: StatsRange, limit = 30): Promise<TopArtist[]> {
  const since = sinceFor(range);
  // groupBy doesn't reach across relations, so we pull trackId counts and
  // aggregate by primaryArtistId in JS. Cardinality is bounded by our library.
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: {
      ...COMPLETED_ONLY,
      ...(since ? { playedAt: { gte: since } } : {}),
    },
    _count: { _all: true },
  });

  if (rows.length === 0) return [];

  const tracks = await db.track.findMany({
    where: { id: { in: rows.map((r) => r.trackId) } },
    select: { id: true, primaryArtistId: true },
  });
  const artistIdByTrackId = new Map(tracks.map((t) => [t.id, t.primaryArtistId]));

  const countByArtist = new Map<string, number>();
  for (const r of rows) {
    const aid = artistIdByTrackId.get(r.trackId);
    if (!aid) continue;
    countByArtist.set(aid, (countByArtist.get(aid) ?? 0) + r._count._all);
  }

  const topIds = [...countByArtist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const artists = await db.artist.findMany({
    where: { id: { in: topIds.map(([id]) => id) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(artists.map((a) => [a.id, a.name]));

  return topIds
    .map(([artistId, playCount]) => {
      const name = nameById.get(artistId);
      if (!name) return null;
      return { artistId, name, playCount };
    })
    .filter((x): x is TopArtist => x !== null);
}

export interface TopAlbum {
  albumId: string;
  title: string;
  artist: string;
  coverArtHash: string | null;
  playCount: number;
}

export async function getTopAlbums(range: StatsRange, limit = 30): Promise<TopAlbum[]> {
  const since = sinceFor(range);
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: {
      ...COMPLETED_ONLY,
      ...(since ? { playedAt: { gte: since } } : {}),
    },
    _count: { _all: true },
  });

  if (rows.length === 0) return [];

  const tracks = await db.track.findMany({
    where: { id: { in: rows.map((r) => r.trackId) }, albumId: { not: null } },
    select: { id: true, albumId: true },
  });
  const albumIdByTrackId = new Map(tracks.map((t) => [t.id, t.albumId]));

  const countByAlbum = new Map<string, number>();
  for (const r of rows) {
    const aid = albumIdByTrackId.get(r.trackId);
    if (!aid) continue;
    countByAlbum.set(aid, (countByAlbum.get(aid) ?? 0) + r._count._all);
  }

  const topIds = [...countByAlbum.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const albums = await db.album.findMany({
    where: { id: { in: topIds.map(([id]) => id) } },
    select: {
      id: true,
      title: true,
      coverArtHash: true,
      artist: { select: { name: true } },
    },
  });
  const byId = new Map(albums.map((a) => [a.id, a]));

  return topIds
    .map(([albumId, playCount]) => {
      const a = byId.get(albumId);
      if (!a) return null;
      return {
        albumId,
        title: a.title,
        artist: a.artist?.name ?? "",
        coverArtHash: a.coverArtHash ?? null,
        playCount,
      };
    })
    .filter((x): x is TopAlbum => x !== null);
}

export interface RecentPlay {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverArtHash: string | null;
  duration: number;
  ytVideoId: string | null;
  playedAt: string; // ISO
}

export async function getRecentlyPlayed(limit = 30): Promise<RecentPlay[]> {
  // Distinct on trackId, latest first — so a song played 5 times in a row shows
  // up once. Prisma doesn't have distinctOn for orderBy joins so we fetch a
  // window and dedupe in JS.
  const rows = await db.listeningHistory.findMany({
    where: { durationListened: { gte: 5 } }, // ignore accidental clicks
    orderBy: { playedAt: "desc" },
    take: limit * 4,
    select: {
      trackId: true,
      playedAt: true,
      track: {
        select: {
          id: true,
          title: true,
          duration: true,
          ytVideoId: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true, coverArtHash: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const out: RecentPlay[] = [];
  for (const r of rows) {
    if (seen.has(r.trackId)) continue;
    seen.add(r.trackId);
    out.push({
      trackId: r.trackId,
      title: r.track.title,
      artist: r.track.primaryArtist.name,
      album: r.track.album?.title ?? "",
      coverArtHash: r.track.album?.coverArtHash ?? null,
      duration: r.track.duration,
      ytVideoId: r.track.ytVideoId ?? null,
      playedAt: r.playedAt.toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface StatsOverview {
  totalPlays: number;
  totalSeconds: number;
  uniqueTracks: number;
  uniqueArtists: number;
}

export async function getStatsOverview(range: StatsRange): Promise<StatsOverview> {
  const since = sinceFor(range);
  const where = {
    ...COMPLETED_ONLY,
    ...(since ? { playedAt: { gte: since } } : {}),
  };

  const [agg, uniqueTracks] = await Promise.all([
    db.listeningHistory.aggregate({
      where,
      _count: { _all: true },
      _sum: { durationListened: true },
    }),
    db.listeningHistory.groupBy({
      by: ["trackId"],
      where,
      _count: { _all: true },
    }),
  ]);

  // Unique artists: pull track→artist map for the unique tracks.
  let uniqueArtists = 0;
  if (uniqueTracks.length > 0) {
    const tracks = await db.track.findMany({
      where: { id: { in: uniqueTracks.map((t) => t.trackId) } },
      select: { primaryArtistId: true },
    });
    uniqueArtists = new Set(tracks.map((t) => t.primaryArtistId)).size;
  }

  return {
    totalPlays: agg._count._all,
    totalSeconds: agg._sum.durationListened ?? 0,
    uniqueTracks: uniqueTracks.length,
    uniqueArtists,
  };
}
