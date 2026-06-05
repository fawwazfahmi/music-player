"use client";

import { useEffect, useState } from "react";
import { getFavoriteTracks } from "@/server/actions/favorites";
import { usePlayerStore } from "@/stores/player-store";
import { HeartIcon, PlayIcon } from "@/components/icons";
import { PageHeader, SongRow, buildQueueTrack } from "./_shared";

export function FavoritesPage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getFavoriteTracks>>>([]);

  useEffect(() => {
    let cancelled = false;
    void getFavoriteTracks().then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue = rows.map((f) =>
    buildQueueTrack({
      id: f.track.id,
      title: f.track.title,
      duration: f.track.duration,
      primaryArtist: f.track.primaryArtist,
      album: f.track.album,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Liked Songs"
        subtitle="Library"
        actions={
          <button
            type="button"
            onClick={() => queue.length > 0 && play(0)}
            disabled={queue.length === 0}
            className="flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
          >
            <PlayIcon size={16} /> Play
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-500">
            <HeartIcon size={48} />
            <p>No favorites yet</p>
            <p className="text-xs text-zinc-600">Heart a song to add it here</p>
          </div>
        ) : (
          queue.map((t, i) => (
            <SongRow
              key={t.id}
              track={t}
              index={i}
              onPlay={play}
              onDeleted={(id) => setRows((prev) => prev.filter((r) => r.track.id !== id))}
            />
          ))
        )}
      </div>
    </div>
  );
}
