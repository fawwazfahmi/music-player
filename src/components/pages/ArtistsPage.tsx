"use client";

import { useEffect, useState } from "react";
import { getArtists } from "@/server/actions/views";
import { useIpodStore } from "@/stores/ipod-store";
import { ArtistIcon } from "@/components/icons";
import { PageHeader } from "./_shared";

export function ArtistsPage() {
  const [artists, setArtists] = useState<Awaited<ReturnType<typeof getArtists>>>([]);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getArtists().then((r) => {
      if (!cancelled) setArtists(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Artists" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {artists.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">No artists yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {artists.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => push({ name: "artistDetail", artistId: a.id })}
                className="group flex flex-col items-center gap-3 rounded-lg p-3 text-center transition hover:bg-zinc-800/50"
              >
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500 shadow-lg ring-1 ring-zinc-800 transition group-hover:scale-105">
                  <ArtistIcon size={36} />
                </div>
                <div className="min-w-0 w-full">
                  <div className="truncate text-sm font-medium text-zinc-100">{a.name}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {a._count.albums} albums · {a._count.tracks} tracks
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
