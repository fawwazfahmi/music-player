"use server";

import { db } from "@/server/db";

export type FavoriteKind = "TRACK" | "ALBUM" | "ARTIST";

export async function isFavorited(kind: FavoriteKind, id: string): Promise<boolean> {
  if (kind === "TRACK") return !!(await db.favoriteTrack.findUnique({ where: { trackId: id } }));
  if (kind === "ALBUM") return !!(await db.favoriteAlbum.findUnique({ where: { albumId: id } }));
  return !!(await db.favoriteArtist.findUnique({ where: { artistId: id } }));
}

export async function toggleFavorite(kind: FavoriteKind, id: string): Promise<boolean> {
  const currentlyFav = await isFavorited(kind, id);
  if (currentlyFav) {
    if (kind === "TRACK") await db.favoriteTrack.delete({ where: { trackId: id } });
    else if (kind === "ALBUM") await db.favoriteAlbum.delete({ where: { albumId: id } });
    else await db.favoriteArtist.delete({ where: { artistId: id } });
    return false;
  }
  if (kind === "TRACK") await db.favoriteTrack.create({ data: { trackId: id } });
  else if (kind === "ALBUM") await db.favoriteAlbum.create({ data: { albumId: id } });
  else await db.favoriteArtist.create({ data: { artistId: id } });
  return true;
}

export async function getFavoriteTracks() {
  return db.favoriteTrack.findMany({
    orderBy: { favoritedAt: "desc" },
    include: {
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
  });
}
