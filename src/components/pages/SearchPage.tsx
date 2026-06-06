"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchLibrary } from "@/server/actions/search";
import type { SearchResults } from "@/server/services/search";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { AlbumIcon, ArtistIcon, MusicNoteIcon, PlaylistIcon, SearchIcon } from "@/components/icons";
import { buildQueueTrack } from "./_shared";

// True for a YouTube URL that points at a playlist / mix (has ?list=…).
function detectYtPlaylistUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!/(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/i.test(u.hostname)) return null;
    if (!u.searchParams.get("list")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface PlaylistTrackResp {
  trackId: string;
  cached: boolean;
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ tracks: [], artists: [], albums: [] });
  const [searching, setSearching] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const push = useIpodStore((s) => s.push);
  const inputRef = useRef<HTMLInputElement>(null);

  const playlistUrl = useMemo(() => detectYtPlaylistUrl(query), [query]);

  async function addPlaylist(mode: "play" | "append") {
    if (!playlistUrl) return;
    setPlaylistBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/yt-playlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { total: number; tracks: PlaylistTrackResp[] };
      const queueTracks = data.tracks.map((t) =>
        buildQueueTrack({
          id: t.trackId,
          title: t.title,
          duration: t.duration,
          artistName: t.uploader,
          albumTitle: "YouTube Mix",
          ytVideoId: t.videoId,
        }),
      );
      if (mode === "play") {
        usePlayerStore.getState().setQueue(queueTracks, 0);
      } else {
        usePlayerStore.getState().addManyToQueue(queueTracks);
      }
      setToast({
        kind: "ok",
        text: `${data.total} song${data.total === 1 ? "" : "s"} added — downloading in the background`,
      });
      setQuery("");
    } catch (err) {
      setToast({
        kind: "err",
        text: err instanceof Error ? err.message : "Playlist failed",
      });
    } finally {
      setPlaylistBusy(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults({ tracks: [], artists: [], albums: [] });
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      void searchLibrary(query)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function playSong(t: SearchResults["tracks"][number]) {
    usePlayerStore.getState().setQueue(
      [
        buildQueueTrack({
          id: t.id,
          title: t.title,
          duration: t.duration,
          artistName: t.artistName,
          albumTitle: t.albumTitle ?? "",
        }),
      ],
      0,
    );
  }

  const totalLocal = results.tracks.length + results.artists.length + results.albums.length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-6">
        <div className="flex items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 ring-1 ring-zinc-800">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="text"
            data-shortcut="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, artists, albums…  (press /)"
            className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {playlistUrl && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-sm text-emerald-200">
              <PlaylistIcon size={16} />
              <span>YouTube playlist / mix detected</span>
            </div>
            <p className="break-all text-xs text-zinc-400">{playlistUrl}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={playlistBusy}
                onClick={() => void addPlaylist("play")}
                className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {playlistBusy ? "Adding…" : "Play playlist"}
              </button>
              <button
                type="button"
                disabled={playlistBusy}
                onClick={() => void addPlaylist("append")}
                className="rounded-full border border-emerald-500/60 px-4 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {playlistBusy ? "Adding…" : "Add to queue"}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Downloads run sequentially in the background. First track might take 30-60s to be playable.
            </p>
          </div>
        )}
        {toast && (
          <div
            className={
              "mb-4 rounded-lg px-3 py-2 text-xs " +
              (toast.kind === "ok"
                ? "bg-emerald-500/15 text-emerald-200"
                : "bg-red-500/15 text-red-200")
            }
          >
            {toast.text}
          </div>
        )}
        {query.trim().length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            Type to search your library, or paste a YouTube playlist URL.
          </p>
        ) : searching ? (
          <p className="py-12 text-center text-sm text-zinc-500">Searching…</p>
        ) : totalLocal === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-zinc-500">
            <p className="text-sm">No local matches for &ldquo;{query}&rdquo;</p>
            <button
              type="button"
              onClick={() => push({ name: "ytPicker", query })}
              className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
            >
              Search YouTube for &ldquo;{query}&rdquo;
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {results.tracks.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <MusicNoteIcon size={16} /> Songs
                </h3>
                <div className="space-y-1">
                  {results.tracks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => playSong(t)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-zinc-800/50"
                    >
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{t.title}</div>
                        <div className="text-xs text-zinc-500">
                          {t.artistName} · {t.albumTitle}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {results.artists.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <ArtistIcon size={16} /> Artists
                </h3>
                <div className="space-y-1">
                  {results.artists.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => push({ name: "artistDetail", artistId: a.id })}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-zinc-800/50"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800">
                        <ArtistIcon size={14} />
                      </div>
                      <span className="text-sm text-zinc-100">{a.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {results.albums.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <AlbumIcon size={16} /> Albums
                </h3>
                <div className="space-y-1">
                  {results.albums.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => push({ name: "albumDetail", albumId: a.id })}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-zinc-800/50"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800">
                        <AlbumIcon size={14} />
                      </div>
                      <div>
                        <div className="text-sm text-zinc-100">{a.title}</div>
                        <div className="text-xs text-zinc-500">{a.artistName}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="border-t border-zinc-800/50 pt-4">
              <button
                type="button"
                onClick={() => push({ name: "ytPicker", query })}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                <SearchIcon size={16} />
                Search YouTube for &ldquo;{query}&rdquo;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
