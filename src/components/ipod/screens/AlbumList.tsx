"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getAllAlbums } from "@/server/actions/views";

export function AlbumList({ selected = 0 }: { selected?: number }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getAllAlbums().then((albums) => {
      if (cancelled) return;
      setRows(
        albums.map((a) => ({
          key: a.id,
          label: a.title,
          trailing: a.artist.name,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center text-zinc-700">
        <div className="text-[11px]">No albums yet.</div>
      </div>
    );
  }

  return <VirtualizedList title="Albums" rows={rows} selected={selected} />;
}
