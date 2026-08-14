"use server";

import { db } from "@/server/db";
import { resolveTrackCoverHash } from "@/lib/cover-url";
import { env } from "@/lib/env";
import { cookies } from "next/headers";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

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

/** Only this identity may look at anyone else's listening. Everyone else is
    scoped to their own, whatever they ask for.

    Enforced here rather than by hiding the picker, so the answer doesn't
    change based on what the client sends. Worth being honest about the
    ceiling though: mu_name is an unsigned cookie (see auth.ts) and both
    people share one app password, so either could set it to the other's name.
    This stops the UI leaking by accident; it is not a security boundary, and
    nothing built on mu_name can be. */
const STATS_ADMIN = "fawwaz";

/** Which listener the caller is actually allowed to see. `requested` is a
    hint from the client and is honoured only for the admin. */
async function resolveListener(requested?: string | null): Promise<string | null> {
  const raw = (await cookies()).get(NAME_COOKIE_NAME)?.value;
  const decoded = raw ? decodeURIComponent(raw) : "";
  const me = isValidName(decoded) ? decoded : null;
  if (me === STATS_ADMIN) return requested ?? null;
  // No identity cookie: nothing to scope to, and blocking would leave the page
  // blank for a session that predates the cookie. Same convenience ceiling.
  return me;
}

/** The one place the Stats page decides what it is counting: real plays, in
    the selected range, optionally for one listener. Every panel uses it, so a
    card and the heatmap beside it can't drift apart. */
function historyWhere(range: StatsRange, listener?: string | null) {
  const since = sinceFor(range);
  return {
    ...COMPLETED_ONLY,
    ...(since ? { playedAt: { gte: since } } : {}),
    ...(listener ? { listener } : {}),
  };
}

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

export async function getTopTracks(
  range: StatsRange,
  listener?: string | null,
  limit = 50,
): Promise<TopTrack[]> {
  listener = await resolveListener(listener);
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: historyWhere(range, listener),
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
      coverArtHash: true,
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
        coverArtHash: resolveTrackCoverHash({
          trackCoverArtHash: t.coverArtHash,
          albumCoverArtHash: t.album?.coverArtHash,
        }),
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

export async function getTopArtists(
  range: StatsRange,
  listener?: string | null,
  limit = 30,
): Promise<TopArtist[]> {
  listener = await resolveListener(listener);
  // groupBy doesn't reach across relations, so we pull trackId counts and
  // aggregate by primaryArtistId in JS. Cardinality is bounded by our library.
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: historyWhere(range, listener),
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

export async function getTopAlbums(
  range: StatsRange,
  listener?: string | null,
  limit = 30,
): Promise<TopAlbum[]> {
  listener = await resolveListener(listener);
  const rows = await db.listeningHistory.groupBy({
    by: ["trackId"],
    where: historyWhere(range, listener),
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

export async function getRecentlyPlayed(
  listener?: string | null,
  limit = 30,
): Promise<RecentPlay[]> {
  listener = await resolveListener(listener);
  // Distinct on trackId, latest first — so a song played 5 times in a row shows
  // up once. Prisma doesn't have distinctOn for orderBy joins so we fetch a
  // window and dedupe in JS.
  const rows = await db.listeningHistory.findMany({
    where: {
      durationListened: { gte: 5 }, // ignore accidental clicks
      ...(listener ? { listener } : {}),
    },
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
          coverArtHash: true,
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
      coverArtHash: resolveTrackCoverHash({
        trackCoverArtHash: r.track.coverArtHash,
        albumCoverArtHash: r.track.album?.coverArtHash,
      }),
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

export async function getStatsOverview(
  range: StatsRange,
  listener?: string | null,
): Promise<StatsOverview> {
  const where = historyWhere(range, await resolveListener(listener));

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

// ─── Listening heatmap ────────────────────────────────────────────────────
//
// Hour-of-day × day-of-week, weighted by seconds listened rather than play
// count so a 20-second skip doesn't count the same as a full song.
//
// This shape was chosen because it aggregates *across* days: with only ~28
// active listening days there isn't enough history for a GitHub-style
// calendar heatmap, but every one of those days still feeds the same 168
// cells, which came out ~48% populated — dense enough to show a pattern.

export interface HeatmapCell {
  /** 0 = Sunday … 6 = Saturday, in local time. */
  dow: number;
  /** 0–23, local time. */
  hour: number;
  seconds: number;
  plays: number;
}

export interface HeatmapResult {
  cells: HeatmapCell[];
  /** Busiest cell, for scaling the colour ramp. 0 when there's no data. */
  maxSeconds: number;
  totalSeconds: number;
  totalPlays: number;
  /** Identities present in the data, for the filter control. */
  listeners: string[];
  /** Timezone the buckets were computed in, so the UI can say so. */
  timeZone: string;
}

/**
 * `listener` filters to one identity; omit for everyone combined.
 *
 * playedAt is a `timestamp without time zone` holding UTC, so it is converted
 * to the app timezone before bucketing. Skipping that conversion puts every
 * bucket 8 hours out here — local midnight would read as 16:00.
 */
export async function getListeningHeatmap(
  listener?: string | null,
  range: StatsRange = "all",
): Promise<HeatmapResult> {
  listener = await resolveListener(listener);
  const since = sinceFor(range);
  const tz = env.APP_TIMEZONE;

  const rows = await db.$queryRaw<
    { dow: number; hour: number; seconds: number; plays: number }[]
  >`
    SELECT
      EXTRACT(DOW  FROM ("playedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS dow,
      EXTRACT(HOUR FROM ("playedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour,
      COALESCE(SUM("durationListened"), 0)::int AS seconds,
      COUNT(*)::int AS plays
    FROM "ListeningHistory"
    -- Same definition of "a play" as the cards above it. Without this the
    -- heatmap counted skips and the two disagreed on screen: 929 plays here
    -- against 855 there, for an identical range.
    WHERE completed = true
      AND (${listener ?? null}::text IS NULL OR "listener" = ${listener ?? null})
      AND (${since ?? null}::timestamp IS NULL OR "playedAt" >= ${since ?? null})
    GROUP BY 1, 2
  `;

  const listenerRows = await db.$queryRaw<{ listener: string }[]>`
    SELECT DISTINCT "listener" FROM "ListeningHistory"
    WHERE "listener" IS NOT NULL ORDER BY 1
  `;

  return {
    cells: rows,
    maxSeconds: rows.reduce((m, r) => Math.max(m, r.seconds), 0),
    totalSeconds: rows.reduce((s, r) => s + r.seconds, 0),
    totalPlays: rows.reduce((s, r) => s + r.plays, 0),
    listeners: listenerRows.map((r) => r.listener),
    timeZone: tz,
  };
}
