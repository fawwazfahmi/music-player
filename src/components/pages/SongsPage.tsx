"use client";

import { useEffect, useState } from "react";
import { getAllSongs } from "@/server/actions/views";
import { usePlayerStore } from "@/stores/player-store";
import { PageHeader, PageLoading, SongRow, buildQueueTrack } from "./_shared";

export function SongsPage() {
  // null = still loading; [] = loaded with zero rows. Distinguishing these
  // lets us show "Loading…" instead of "Library is empty" while the fetch
  // is in flight (which can be a few seconds while a YT download is busy
  // on the server).
  const [songs, setSongs] = useState<Awaited<ReturnType<typeof getAllSongs>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    console.log("[mu] SongsPage: fetching getAllSongs…");
    void getAllSongs()
      .then((r) => {
        if (cancelled) return;
        console.log(`[mu] SongsPage: got ${r.length} rows in ${Date.now() - t0}ms`);
        setSongs(r);
      })
      .catch((e) => {
        console.error("[mu] SongsPage: getAllSongs failed", e);
        if (!cancelled) setSongs([]); // surface as empty rather than hung
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue =
    songs?.map((s) =>
      buildQueueTrack({
        id: s.id,
        title: s.title,
        duration: s.duration,
        primaryArtist: s.primaryArtist,
        album: s.album,
        ytVideoId: s.ytVideoId,
      }),
    ) ?? [];

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Songs" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {songs === null ? (
          <PageLoading message="Loading your library…" />
        ) : queue.length === 0 ? (
          <p className="px-3 py-12 text-center text-sm text-zinc-500">
            No songs yet. Drop m4a/mp3 files into your music folder or use Search → YouTube.
          </p>
        ) : (
          queue.map((t, i) => (
            <SongRow
              key={t.id}
              track={t}
              index={i}
              onPlay={play}
              onDeleted={(id) =>
                setSongs((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
