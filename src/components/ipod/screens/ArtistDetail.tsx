"use client";

import { useEffect, useState } from "react";
import { getTracksByArtist, getArtists } from "@/server/actions/views";
import { toggleFavorite, isFavorited } from "@/server/actions/favorites";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface Props {
  artistId: string;
  selected?: number;
}

interface Row {
  id: string;
  title: string;
  duration: number;
  albumTitle: string;
}

export function ArtistDetail({ artistId, selected = 0 }: Props) {
  const [name, setName] = useState<string>("");
  const [bio, setBio] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fav, setFav] = useState(false);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getTracksByArtist(artistId),
      getArtists(),
      isFavorited("ARTIST", artistId),
    ]).then(([tracks, artists, f]) => {
      if (cancelled) return;
      const artist = artists.find((a) => a.id === artistId);
      setName(artist?.name ?? "Unknown");
      setBio(artist?.bio ?? null);
      setRows(
        tracks.map((t) => ({
          id: t.id,
          title: t.title,
          duration: t.duration,
          albumTitle: t.album?.title ?? "",
        })),
      );
      setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  // Row 0 is fav toggle, rows 1..N are tracks
  const total = 1 + rows.length;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: total } }));
  }, [total]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        void toggleFavorite("ARTIST", artistId).then(setFav);
        return;
      }
      const track = rows[idx - 1];
      if (!track) return;
      usePlayerStore.getState().setQueue(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          artist: name,
          album: r.albumTitle,
        })),
        idx - 1,
      );
      push({ name: "nowPlaying" });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, name, artistId, push]);

  const safeSel = Math.min(Math.max(0, selected), Math.max(0, total - 1));

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {name || "Loading..."}
      </div>
      {bio && (
        <div className="border-b border-black/10 bg-white/40 px-2 py-1 text-[9px] leading-tight text-zinc-700">
          <p className="line-clamp-3">{bio}</p>
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
          <span>{fav ? "♥ Favorited" : "♡ Favorite Artist"}</span>
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
