"use client";

import { useEffect, useState } from "react";
import { deletePlaylist, getPlaylistWithTracks } from "@/server/actions/playlists";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { DeleteIcon, PlayIcon, PlaylistIcon } from "@/components/icons";
import { PageHeader, SongRow, buildQueueTrack } from "./_shared";

interface Props {
  playlistId: string;
}

export function PlaylistDetailPage({ playlistId }: Props) {
  const [pl, setPl] = useState<Awaited<ReturnType<typeof getPlaylistWithTracks>>>(null);
  const pop = useIpodStore((s) => s.pop);
  const toRoot = useIpodStore((s) => s.toRoot);

  useEffect(() => {
    let cancelled = false;
    void getPlaylistWithTracks(playlistId).then((r) => {
      if (!cancelled) setPl(r);
    });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  if (!pl) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }

  const queue = pl.tracks.map((t) =>
    buildQueueTrack({
      id: t.id,
      title: t.title,
      duration: t.duration,
      primaryArtist: t.primaryArtist,
      album: t.album,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  async function onDelete() {
    if (!confirm(`Delete playlist "${pl?.name}"?`)) return;
    await deletePlaylist(playlistId);
    toRoot();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={pl.name}
        subtitle={`Playlist · ${pl.tracks.length} song${pl.tracks.length === 1 ? "" : "s"}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => queue.length > 0 && play(0)}
              disabled={queue.length === 0}
              className="flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              <PlayIcon size={16} /> Play
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full p-2 text-zinc-500 transition hover:text-red-400"
              aria-label="Delete playlist"
              title="Delete playlist"
            >
              <DeleteIcon size={18} />
            </button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-500">
            <PlaylistIcon size={48} />
            <p>Empty playlist</p>
            <p className="text-xs text-zinc-600">Add tracks by hearting or via context menu (coming soon)</p>
          </div>
        ) : (
          queue.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={play} />)
        )}
      </div>
    </div>
  );
}
