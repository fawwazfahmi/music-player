"use client";

import { useEffect, useState } from "react";
import { getPlaylistWithTracks, deletePlaylist } from "@/server/actions/playlists";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";

interface Props {
  playlistId: string;
  selected?: number;
}

interface Row {
  id: string;
  title: string;
  duration: number;
  artist: string;
  album: string;
}

export function PlaylistDetail({ playlistId, selected = 0 }: Props) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);

  useEffect(() => {
    let cancelled = false;
    void getPlaylistWithTracks(playlistId).then((pl) => {
      if (cancelled || !pl) return;
      setName(pl.name);
      setRows(
        pl.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          duration: t.duration,
          artist: t.primaryArtist.name,
          album: t.album?.title ?? "",
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  // Row 0 = "Delete Playlist", rows 1..N = tracks
  const total = 1 + rows.length;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: total } }));
  }, [total]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        void deletePlaylist(playlistId).then(() => pop());
        return;
      }
      const track = rows[idx - 1];
      if (!track) return;
      usePlayerStore.getState().setQueue(rows.map((r) => ({
        id: r.id, title: r.title, duration: r.duration, artist: r.artist, album: r.album,
      })), idx - 1);
      push({ name: "nowPlaying" });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, playlistId, push, pop]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {name || "Loading..."}
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className={
            "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
            (selected === 0
              ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
              : "")
          }
        >
          <span className="text-red-700">⌫ Delete Playlist</span>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i + 1 === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <span className="truncate">{r.title}</span>
            <span className="ml-2 text-[9px] opacity-70">{formatDuration(r.duration)}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-2 py-2 text-center text-[9px] text-zinc-600">
            No tracks yet.
          </div>
        )}
      </div>
    </div>
  );
}
