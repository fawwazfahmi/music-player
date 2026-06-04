"use client";

import { useEffect, useState } from "react";
import { VirtualizedList, type Row } from "./VirtualizedList";
import { getArtists } from "@/server/actions/views";

export function ArtistList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getArtists().then((artists) => {
      if (cancelled) return;
      setRows(
        artists.map((a) => ({
          key: a.id,
          label: a.name,
          trailing: `${a._count.albums}`,
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
        <div className="text-center">
          <div className="text-[11px]">No artists yet.</div>
          <div className="mt-1 text-[9px] opacity-70">Settings → Rescan Library</div>
        </div>
      </div>
    );
  }

  return <VirtualizedList title="Artists" rows={rows} selected={selected} />;
}
