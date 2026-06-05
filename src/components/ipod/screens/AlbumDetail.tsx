"use client";

import { useEffect, useState } from "react";
import { getTracksByAlbum, getAllAlbums } from "@/server/actions/views";
import { toggleFavorite, isFavorited } from "@/server/actions/favorites";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface Props {
  albumId: string;
  selected?: number;
}

interface Row {
  id: string;
  title: string;
  duration: number;
  trackNumber: number | null;
  artistName: string;
}

export function AlbumDetail({ albumId, selected = 0 }: Props) {
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [coverArtHash, setCoverArtHash] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fav, setFav] = useState(false);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getTracksByAlbum(albumId),
      getAllAlbums(),
      isFavorited("ALBUM", albumId),
    ]).then(([tracks, albums, f]) => {
      if (cancelled) return;
      const album = albums.find((a) => a.id === albumId);
      setTitle(album?.title ?? "Unknown");
      setArtistName(album?.artist.name ?? "");
      setCoverArtHash(album?.coverArtHash ?? null);
      setRows(
        tracks.map((t) => ({
          id: t.id,
          title: t.title,
          duration: t.duration,
          trackNumber: t.trackNumber,
          artistName: t.primaryArtist.name,
        })),
      );
      setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const total = 1 + rows.length;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: total } }));
  }, [total]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        void toggleFavorite("ALBUM", albumId).then(setFav);
        return;
      }
      const track = rows[idx - 1];
      if (!track) return;
      usePlayerStore.getState().setQueue(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          artist: r.artistName,
          album: title,
        })),
        idx - 1,
      );
      push({ name: "nowPlaying" });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, title, albumId, push]);

  const safeSel = Math.min(Math.max(0, selected), Math.max(0, total - 1));

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {title || "Loading..."}
      </div>
      {coverArtHash && (
        <div className="flex justify-center border-b border-black/10 bg-white/40 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/art/${coverArtHash}`}
            alt=""
            className="h-14 w-14 rounded-sm object-cover shadow"
          />
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <div
          className={
            "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
            (safeSel === 0
              ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
              : "")
          }
        >
          <span>{fav ? "♥ Favorited" : "♡ Favorite Album"}</span>
          {artistName && <span className="ml-2 text-[9px] opacity-70">{artistName}</span>}
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i + 1 === safeSel
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <span className="truncate">{r.title}</span>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
