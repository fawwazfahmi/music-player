"use client";

import { useEffect, useState } from "react";
import { getFavoriteTracks } from "@/server/actions/favorites";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface Props {
  selected?: number;
}

interface Row {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
}

export function FavoritesList({ selected = 0 }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getFavoriteTracks().then((favs) => {
      if (cancelled) return;
      setRows(
        favs.map((f) => ({
          id: f.track.id,
          title: f.track.title,
          duration: f.track.duration,
          artist: f.track.primaryArtist.name,
          album: f.track.album?.title ?? "",
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: rows.length } }));
  }, [rows]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      const track = rows[idx];
      if (!track) return;
      usePlayerStore.getState().setQueue(rows, idx);
      push({ name: "nowPlaying" });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, push]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
          Favorites
        </div>
        <div className="grid flex-1 place-items-center px-3 text-center text-[10px] text-zinc-700">
          <div>
            <div>No favorites yet.</div>
            <div className="mt-1 text-[9px] opacity-70">Heart a track to start.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Favorites
      </div>
      <div className="flex-1 overflow-auto">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{r.title}</div>
              <div className="truncate text-[9px] opacity-70">{r.artist}</div>
            </div>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
