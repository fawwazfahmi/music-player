"use client";

import { useEffect, useState } from "react";
import { getTracksByTag, type TaggedTrackSummary, type TagSummary } from "@/server/actions/tags";
import { usePlayerStore } from "@/stores/player-store";
import { PageHeader, PageLoading, SongRow, buildQueueTrack } from "./_shared";
import { PlayIcon } from "@/components/icons";

interface Props {
  tagId: string;
}

export function TagDetailPage({ tagId }: Props) {
  const [data, setData] = useState<{ tag: TagSummary | null; tracks: TaggedTrackSummary[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void getTracksByTag(tagId).then((r) => {
      if (!cancelled) setData(r);
    });
    return () => {
      cancelled = true;
    };
  }, [tagId]);

  if (data === null) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Loading…" subtitle="Tag" />
        <PageLoading message="Loading tracks…" />
      </div>
    );
  }

  if (!data.tag) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Tag not found.
      </div>
    );
  }

  const queue = data.tracks.map((t) =>
    buildQueueTrack({
      id: t.id,
      title: t.title,
      duration: t.duration,
      artistName: t.artist,
      albumTitle: t.album,
      coverArtHash: t.coverArtHash,
      ytVideoId: t.ytVideoId,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={data.tag.name}
        subtitle={`Tag · ${data.tracks.length} track${data.tracks.length === 1 ? "" : "s"}`}
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
          <p className="px-3 py-12 text-center text-sm text-zinc-500">
            No tracks have this tag (yet).
          </p>
        ) : (
          queue.map((t, i) => (
            <SongRow
              key={t.id}
              track={t}
              index={i}
              onPlay={play}
              onDeleted={(id) =>
                setData((prev) =>
                  prev ? { ...prev, tracks: prev.tracks.filter((x) => x.id !== id) } : prev,
                )
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
