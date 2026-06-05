"use client";

import { useEffect, useState } from "react";
import { getAllAlbums, getArtists, getAllSongs } from "@/server/actions/views";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { AlbumIcon, ArtistIcon, MusicNoteIcon, PlayIcon } from "@/components/icons";
import { buildQueueTrack } from "./_shared";

export function HomePage() {
  const [songs, setSongs] = useState<Awaited<ReturnType<typeof getAllSongs>>>([]);
  const [albums, setAlbums] = useState<Awaited<ReturnType<typeof getAllAlbums>>>([]);
  const [artists, setArtists] = useState<Awaited<ReturnType<typeof getArtists>>>([]);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getAllSongs(), getAllAlbums(), getArtists()]).then(([s, al, ar]) => {
      if (cancelled) return;
      setSongs(s);
      setAlbums(al);
      setArtists(ar);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function playSongAt(i: number) {
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
    usePlayerStore.getState().setQueue(queue, i);
  }

  const recent = songs.slice(0, 6);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-100">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Pick up where you left off.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {songs.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <MusicNoteIcon size={48} />
            <h2 className="mt-3 text-lg font-semibold text-zinc-100">Library is empty</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Add audio files to your music folder, or use Search → YouTube to grab a song.
            </p>
            <button
              type="button"
              onClick={() => push({ name: "search" })}
              className="mt-4 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Search
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Recently added — quick tiles */}
            <section>
              <h2 className="mb-3 text-lg font-bold text-zinc-100">Your library</h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {recent.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => playSongAt(i)}
                    className="group flex items-center gap-3 overflow-hidden rounded-lg bg-zinc-900/50 transition hover:bg-zinc-800"
                  >
                    {s.album?.coverArtHash ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/art/${s.album.coverArtHash}`}
                        alt=""
                        className="h-16 w-16 shrink-0 object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
                        <MusicNoteIcon size={24} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 pr-3 text-left">
                      <div className="truncate text-sm font-semibold text-zinc-100">
                        {s.title}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {s.primaryArtist.name}
                      </div>
                    </div>
                    <div className="mr-3 rounded-full bg-emerald-500 p-2 text-zinc-950 opacity-0 transition group-hover:opacity-100">
                      <PlayIcon size={16} />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {albums.length > 0 && (
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold text-zinc-100">Albums</h2>
                  <button
                    type="button"
                    onClick={() => push({ name: "albumList" })}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    See all →
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {albums.slice(0, 6).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => push({ name: "albumDetail", albumId: a.id })}
                      className="group flex flex-col gap-2 rounded-lg p-2 text-left transition hover:bg-zinc-800/50"
                    >
                      {a.coverArtHash ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/art/${a.coverArtHash}`}
                          alt=""
                          className="aspect-square w-full rounded object-cover shadow"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center rounded bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
                          <AlbumIcon size={32} />
                        </div>
                      )}
                      <div className="min-w-0 w-full">
                        <div className="truncate text-sm font-medium text-zinc-100">{a.title}</div>
                        <div className="truncate text-xs text-zinc-500">{a.artist.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {artists.length > 0 && (
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-bold text-zinc-100">Artists</h2>
                  <button
                    type="button"
                    onClick={() => push({ name: "artistList" })}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    See all →
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
                  {artists.slice(0, 6).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => push({ name: "artistDetail", artistId: a.id })}
                      className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center transition hover:bg-zinc-800/50"
                    >
                      <div className="flex aspect-square w-full items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500 shadow">
                        <ArtistIcon size={36} />
                      </div>
                      <div className="min-w-0 w-full">
                        <div className="truncate text-sm font-medium text-zinc-100">{a.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
