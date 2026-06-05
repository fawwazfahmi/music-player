"use client";

import { useEffect, useState } from "react";
import { getAllAlbums } from "@/server/actions/views";
import { useIpodStore } from "@/stores/ipod-store";
import { AlbumIcon } from "@/components/icons";
import { PageHeader } from "./_shared";

export function AlbumsPage() {
  const [albums, setAlbums] = useState<Awaited<ReturnType<typeof getAllAlbums>>>([]);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getAllAlbums().then((r) => {
      if (!cancelled) setAlbums(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Albums" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {albums.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">No albums yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {albums.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => push({ name: "albumDetail", albumId: a.id })}
                className="group flex flex-col items-start gap-2 rounded-lg p-3 text-left transition hover:bg-zinc-800/50"
              >
                {a.coverArtHash ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/art/${a.coverArtHash}`}
                    alt=""
                    className="aspect-square w-full rounded object-cover shadow-lg transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500 shadow-lg transition group-hover:scale-105">
                    <AlbumIcon size={48} />
                  </div>
                )}
                <div className="min-w-0 w-full">
                  <div className="truncate text-sm font-medium text-zinc-100">{a.title}</div>
                  <div className="truncate text-xs text-zinc-500">{a.artist.name}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
