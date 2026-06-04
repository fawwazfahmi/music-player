"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getAllSongs } from "@/server/actions/views";
import { formatDuration } from "@/lib/format-duration";

export function SongList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAllSongs().then((songs) => {
      if (cancelled) return;
      setRows(
        songs.map((s) => ({
          key: s.id,
          label: s.title,
          trailing: formatDuration(s.duration),
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
        <div className="text-[11px]">No songs yet.</div>
      </div>
    );
  }

  return <VirtualizedList title="Songs" rows={rows} selected={selected} />;
}
