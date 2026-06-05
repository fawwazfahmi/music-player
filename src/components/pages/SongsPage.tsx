"use client";

import { useEffect, useState } from "react";
import { getAllSongs } from "@/server/actions/views";
import { usePlayerStore } from "@/stores/player-store";
import { PageHeader, SongRow, buildQueueTrack } from "./_shared";

export function SongsPage() {
  const [songs, setSongs] = useState<Awaited<ReturnType<typeof getAllSongs>>>([]);

  useEffect(() => {
    let cancelled = false;
    void getAllSongs().then((r) => {
      if (!cancelled) setSongs(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue = songs.map((s) =>
    buildQueueTrack({
      id: s.id,
      title: s.title,
      duration: s.duration,
      primaryArtist: s.primaryArtist,
      album: s.album,
      ytVideoId: s.ytVideoId,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Songs" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <p className="px-3 py-12 text-center text-sm text-zinc-500">
            No songs yet. Drop m4a/mp3 files into your music folder or use Search → YouTube.
          </p>
        ) : (
          queue.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={play} />)
        )}
      </div>
    </div>
  );
}
