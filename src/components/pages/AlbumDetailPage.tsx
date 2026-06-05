"use client";

import { useEffect, useState } from "react";
import { getAllAlbums, getTracksByAlbum } from "@/server/actions/views";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";
import { usePlayerStore } from "@/stores/player-store";
import { HeartIcon, HeartOutlineIcon, PlayIcon } from "@/components/icons";
import { PageHeader, SongRow, buildQueueTrack } from "./_shared";

interface Props {
  albumId: string;
}

export function AlbumDetailPage({ albumId }: Props) {
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [coverArtHash, setCoverArtHash] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Awaited<ReturnType<typeof getTracksByAlbum>>>([]);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getTracksByAlbum(albumId),
      getAllAlbums(),
      isFavorited("ALBUM", albumId),
    ]).then(([ts, albums, f]) => {
      if (cancelled) return;
      const album = albums.find((a) => a.id === albumId);
      setTitle(album?.title ?? "Unknown");
      setArtistName(album?.artist.name ?? "");
      setCoverArtHash(album?.coverArtHash ?? null);
      setTracks(ts);
      setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const queue = tracks.map((t) =>
    buildQueueTrack({
      id: t.id,
      title: t.title,
      duration: t.duration,
      primaryArtist: t.primaryArtist,
      albumTitle: title,
      coverArtHash,
      ytVideoId: t.ytVideoId,
    }),
  );

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  async function onToggleFav() {
    setFav(await toggleFavorite("ALBUM", albumId));
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={title || "Loading..."}
        subtitle={artistName ? `Album · ${artistName}` : "Album"}
        cover={coverArtHash ? `/api/art/${coverArtHash}` : null}
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
              onClick={onToggleFav}
              className={
                "rounded-full p-2 transition " +
                (fav ? "text-red-500 hover:text-red-400" : "text-zinc-400 hover:text-zinc-200")
              }
              aria-label={fav ? "Unfavorite" : "Favorite"}
            >
              {fav ? <HeartIcon size={22} /> : <HeartOutlineIcon size={22} />}
            </button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <p className="px-3 py-12 text-center text-sm text-zinc-500">No tracks.</p>
        ) : (
          queue.map((t, i) => (
            <SongRow key={t.id} track={t} index={i} onPlay={play} showAlbum={false} />
          ))
        )}
      </div>
    </div>
  );
}
