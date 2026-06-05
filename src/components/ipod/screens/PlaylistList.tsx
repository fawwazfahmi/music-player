"use client";

import { useEffect, useState } from "react";
import { getPlaylists } from "@/server/actions/playlists";
import { useIpodStore } from "@/stores/ipod-store";

interface Props {
  selected?: number;
}

interface PlRow {
  id: string;
  name: string;
  count: number;
}

export function PlaylistList({ selected = 0 }: Props) {
  const [rows, setRows] = useState<PlRow[]>([]);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getPlaylists().then((pls) => {
      if (cancelled) return;
      setRows(pls.map((p) => ({ id: p.id, name: p.name, count: p._count.tracks })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Row 0 = "+ New Playlist", rows 1..N = existing
  const total = 1 + rows.length;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: total } }));
  }, [total]);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        push({ name: "newPlaylist" });
        return;
      }
      const pl = rows[idx - 1];
      if (!pl) return;
      push({ name: "playlistDetail", playlistId: pl.id });
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, [rows, push]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Playlists
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
          <span>+ New Playlist</span>
        </div>
        {rows.map((p, i) => (
          <div
            key={p.id}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i + 1 === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <span className="truncate">{p.name}</span>
            <span className="ml-2 text-[9px] opacity-70">{p.count}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-2 py-2 text-center text-[9px] text-zinc-600">
            No playlists yet.
          </div>
        )}
      </div>
    </div>
  );
}
