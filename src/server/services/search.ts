import { db } from "@/server/db";

export interface SearchTrackResult {
  id: string;
  title: string;
  duration: number;
  artistId: string;
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  score: number;
}

export interface SearchArtistResult {
  id: string;
  name: string;
  score: number;
}

export interface SearchAlbumResult {
  id: string;
  title: string;
  artistName: string;
  score: number;
}

export interface SearchResults {
  tracks: SearchTrackResult[];
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
}

const MIN_SIMILARITY = 0.1;
const LIMIT_PER_CATEGORY = 10;

export async function searchLibrary(query: string): Promise<SearchResults> {
  const q = query.trim();
  if (q.length === 0) return { tracks: [], artists: [], albums: [] };

  const [tracks, artists, albums] = await Promise.all([
    db.$queryRaw<SearchTrackResult[]>`
      SELECT t.id, t.title, t.duration,
             ar.id AS "artistId", ar.name AS "artistName",
             al.id AS "albumId", al.title AS "albumTitle",
             similarity(t.title, ${q}) AS score
      FROM "Track" t
      JOIN "Artist" ar ON t."primaryArtistId" = ar.id
      LEFT JOIN "Album" al ON t."albumId" = al.id
      WHERE t.playable = true AND t.title % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
    db.$queryRaw<SearchArtistResult[]>`
      SELECT id, name, similarity(name, ${q}) AS score
      FROM "Artist"
      WHERE name % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
    db.$queryRaw<SearchAlbumResult[]>`
      SELECT al.id, al.title, ar.name AS "artistName",
             similarity(al.title, ${q}) AS score
      FROM "Album" al
      JOIN "Artist" ar ON al."artistId" = ar.id
      WHERE al.title % ${q}
      ORDER BY score DESC
      LIMIT ${LIMIT_PER_CATEGORY}
    `,
  ]);

  return {
    tracks: tracks.filter((r) => r.score >= MIN_SIMILARITY),
    artists: artists.filter((r) => r.score >= MIN_SIMILARITY),
    albums: albums.filter((r) => r.score >= MIN_SIMILARITY),
  };
}
