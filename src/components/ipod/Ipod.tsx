"use client";

import { useEffect, useRef, useState } from "react";
import { Chassis } from "./Chassis";
import { ClickWheel, type WheelEventOut } from "./ClickWheel";
import { Screen } from "./Screen";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";
import { bindMediaSession, updateMediaMetadata } from "@/audio/media-session";
import {
  getAllAlbums,
  getAllSongs,
  getArtists,
} from "@/server/actions/views";
import { startPlay, updatePlayProgress } from "@/server/actions/playback";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";

const HOLD_MENU_MS = 600;

export function Ipod() {
  const current = useIpodStore((s) => s.current());
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const toRoot = useIpodStore((s) => s.toRoot);

  const player = usePlayerStore();
  const selected = useIpodStore((s) => s.getSelectionFor(current));
  const setSelectionFor = useIpodStore((s) => s.setSelectionFor);
  const setSelected = (n: number | ((prev: number) => number)) => {
    const next = typeof n === "function" ? n(selected) : n;
    setSelectionFor(current, next);
  };
  const [rowCount, setRowCount] = useState(0);
  const menuDownAt = useRef<number | null>(null);

  // Recompute row count when screen changes (async work belongs in effect)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let count = 0;
      if (current.name === "home") count = 4;
      else if (current.name === "musicSub") count = 5;
      else if (current.name === "artistList") count = (await getArtists()).length;
      else if (current.name === "albumList") count = (await getAllAlbums()).length;
      else if (current.name === "songList") count = (await getAllSongs()).length;
      if (!cancelled) setRowCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [current.name]);

  // Listen for row-count updates published by self-managing screens (e.g. Search, YtPicker)
  useEffect(() => {
    function handler(e: Event) {
      setRowCount((e as CustomEvent<{ count: number }>).detail.count);
    }
    window.addEventListener("ipod-row-count", handler as EventListener);
    return () => window.removeEventListener("ipod-row-count", handler as EventListener);
  }, []);

  // Audio engine: load track when currentIndex changes
  useEffect(() => {
    const engine = getEngine();
    const track = player.queue[player.currentIndex];
    if (!track) return;
    engine.loadTrack(track.id);
    updateMediaMetadata(track);
    if (player.isPlaying) void engine.play();
  }, [player.currentIndex, player.queue, player.isPlaying]);

  // Play/pause sync
  useEffect(() => {
    const engine = getEngine();
    if (player.isPlaying) void engine.play();
    else engine.pause();
  }, [player.isPlaying]);

  // Volume sync
  useEffect(() => {
    getEngine().setVolume(player.volume);
  }, [player.volume]);

  // Playback recording — start a new history row on track change while playing
  const historyIdRef = useRef<string | null>(null);
  const lastReportedSecondRef = useRef(0);

  useEffect(() => {
    const track = player.queue[player.currentIndex];
    if (!track || !player.isPlaying) return;
    let cancelled = false;
    void startPlay(track.id).then((id) => {
      if (cancelled) return;
      historyIdRef.current = id;
      lastReportedSecondRef.current = 0;
    });
    return () => {
      cancelled = true;
    };
  }, [player.currentIndex, player.isPlaying, player.queue]);

  // Time tick → store + throttled history update
  useEffect(() => {
    const engine = getEngine();
    return engine.on("timeupdate", () => {
      const t = engine.getCurrentTime();
      usePlayerStore.getState().setPosition(t);
      const track = player.queue[player.currentIndex];
      if (historyIdRef.current && track && track.duration > 0) {
        if (Math.floor(t) - lastReportedSecondRef.current >= 5) {
          const completed = t / track.duration >= 0.8;
          void updatePlayProgress(historyIdRef.current, t, completed);
          lastReportedSecondRef.current = Math.floor(t);
        }
      }
    });
  }, [player.currentIndex, player.queue]);

  // Auto-advance on end
  useEffect(() => {
    return getEngine().on("ended", () => {
      usePlayerStore.getState().next();
    });
  }, []);

  // Media session
  useEffect(() => {
    return bindMediaSession({
      onPlay: () => usePlayerStore.setState({ isPlaying: true }),
      onPause: () => usePlayerStore.setState({ isPlaying: false }),
      onPrev: () => usePlayerStore.getState().prev(),
      onNext: () => usePlayerStore.getState().next(),
      onSeekTo: (s) => {
        getEngine().seek(s);
        usePlayerStore.setState({ position: s });
      },
    });
  }, []);

  async function handleSelect() {
    const sel = selected;
    if (current.name === "home") {
      if (sel === 0) push({ name: "musicSub" });
      else if (sel === 1) push({ name: "search" });
      else if (sel === 2) push({ name: "nowPlaying" });
      else if (sel === 3) push({ name: "settings" });
    } else if (current.name === "nowPlaying") {
      const t = usePlayerStore.getState().currentTrack();
      if (t) push({ name: "notes", trackId: t.id });
    } else if (
      current.name === "search" ||
      current.name === "ytPicker" ||
      current.name === "settings" ||
      current.name === "artistDetail" ||
      current.name === "albumDetail" ||
      current.name === "playlistList" ||
      current.name === "playlistDetail" ||
      current.name === "favoritesList"
    ) {
      window.dispatchEvent(new CustomEvent("ipod-select", { detail: { selected } }));
    } else if (current.name === "musicSub") {
      if (sel === 0) push({ name: "artistList" });
      else if (sel === 1) push({ name: "albumList" });
      else if (sel === 2) push({ name: "songList" });
      else if (sel === 3) push({ name: "playlistList" });
      else if (sel === 4) push({ name: "favoritesList" });
    } else if (current.name === "artistList") {
      const artists = await getArtists();
      const artist = artists[sel];
      if (artist) push({ name: "artistDetail", artistId: artist.id });
    } else if (current.name === "albumList") {
      const albums = await getAllAlbums();
      const album = albums[sel];
      if (album) push({ name: "albumDetail", albumId: album.id });
    } else if (current.name === "songList") {
      const songs = await getAllSongs();
      const queue = songs.map((s) => ({
        id: s.id,
        title: s.title,
        duration: s.duration,
        artist: s.primaryArtist.name,
        album: s.album?.title ?? "",
        coverArtHash: s.album?.coverArtHash ?? null,
      }));
      usePlayerStore.getState().setQueue(queue, sel);
      push({ name: "nowPlaying" });
    }
  }

  function handleEvent(e: WheelEventOut) {
    switch (e.type) {
      case "scroll":
        if (current.name === "nowPlaying") {
          // On NowPlaying, scroll adjusts volume (like a real iPod click wheel)
          const cur = usePlayerStore.getState().volume;
          const step = 0.05;
          const next = Math.max(0, Math.min(1, cur - e.delta * step));
          usePlayerStore.getState().setVolume(next);
          window.dispatchEvent(new CustomEvent("ipod-volume-changed"));
        } else if (rowCount > 0) {
          setSelected((s) => Math.max(0, Math.min(rowCount - 1, s + e.delta)));
        }
        break;
      case "select":
        void handleSelect();
        break;
      case "menu":
        if (menuDownAt.current === null) {
          menuDownAt.current = Date.now();
          setTimeout(() => {
            if (menuDownAt.current !== null && Date.now() - menuDownAt.current >= HOLD_MENU_MS) {
              toRoot();
              menuDownAt.current = null;
            }
          }, HOLD_MENU_MS);
        }
        pop();
        menuDownAt.current = null;
        break;
      case "playPause":
        usePlayerStore.getState().togglePlay();
        break;
      case "next":
        usePlayerStore.getState().next();
        break;
      case "prev":
        usePlayerStore.getState().prev();
        break;
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
        <div data-selected={selected} data-row-count={rowCount}>
          <Chassis screen={<Screen selected={selected} />} wheel={<ClickWheel onEvent={handleEvent} />} />
        </div>
        <div className="md:pt-2">
          <PersistentPlayerPanel />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Selected: {selected} / {Math.max(0, rowCount - 1)}
      </p>
    </main>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function PersistentPlayerPanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);

  const track = queue[currentIndex] ?? null;
  const [fav, setFav] = useState(false);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    void isFavorited("TRACK", track.id).then((f) => {
      if (!cancelled) setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [track]);

  useEffect(() => {
    function handler() {
      if (!track) return;
      void isFavorited("TRACK", track.id).then(setFav);
    }
    window.addEventListener("ipod-fav-changed", handler);
    return () => window.removeEventListener("ipod-fav-changed", handler);
  }, [track]);

  async function onToggleFav() {
    if (!track) return;
    const newFav = await toggleFavorite("TRACK", track.id);
    setFav(newFav);
    window.dispatchEvent(new CustomEvent("ipod-fav-changed"));
  }

  function seekTo(seconds: number) {
    if (!track) return;
    getEngine().seek(seconds);
    usePlayerStore.setState({ position: seconds });
  }

  const dur = track?.duration ?? 0;
  const pos = track ? position : 0;
  const hasTrack = !!track;

  return (
    <aside className="flex w-72 flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-zinc-300 shadow-xl backdrop-blur">
      {/* Track header */}
      <div className="flex items-start gap-3">
        {track?.coverArtHash ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/art/${track.coverArtHash}`}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-cover shadow-lg"
          />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded bg-gradient-to-br from-[#5b7fb8] to-[#2a3a55] opacity-60 shadow-lg" />
        )}
        <div className="min-w-0 flex-1">
          {track ? (
            <>
              <div className="truncate text-[13px] font-semibold text-zinc-100">{track.title}</div>
              <div className="truncate text-[11px] text-zinc-400">{track.artist}</div>
              <div className="truncate text-[10px] text-zinc-500">{track.album}</div>
            </>
          ) : (
            <>
              <div className="truncate text-[13px] font-semibold text-zinc-500">Nothing playing</div>
              <div className="truncate text-[11px] text-zinc-600">Pick a song to start</div>
              <div className="truncate text-[10px] text-zinc-700">—</div>
            </>
          )}
        </div>
        {hasTrack && (
          <button
            type="button"
            onClick={onToggleFav}
            className={
              "shrink-0 rounded-full p-1.5 text-[16px] leading-none transition " +
              (fav
                ? "text-red-500 hover:text-red-400"
                : "text-zinc-500 hover:text-zinc-300")
            }
            aria-label={fav ? "Unfavorite" : "Favorite"}
            title={fav ? "Unfavorite" : "Favorite"}
          >
            {fav ? "♥" : "♡"}
          </button>
        )}
      </div>

      {/* Scrub bar */}
      <div>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(dur))}
          value={Math.min(Math.floor(pos), Math.floor(dur))}
          onChange={(e) => seekTo(Number(e.target.value))}
          disabled={!hasTrack}
          className="w-full accent-zinc-200 disabled:opacity-40"
          aria-label="seek"
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-zinc-500">
          <span>{formatTime(pos)}</span>
          <span>{hasTrack ? `−${formatTime(Math.max(0, dur - pos))}` : "—"}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setShuffle(!shuffle)}
          className={
            "rounded p-1 text-[14px] transition " +
            (shuffle ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300")
          }
          aria-pressed={shuffle}
          title="Shuffle"
        >
          ⇄
        </button>
        <button
          type="button"
          onClick={prev}
          disabled={!hasTrack}
          className="rounded p-1 text-[18px] text-zinc-300 transition hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-300"
          aria-label="Previous"
          title="Previous"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasTrack}
          className="rounded-full bg-zinc-100 px-3 py-1 text-[18px] text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-zinc-100"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!hasTrack}
          className="rounded p-1 text-[18px] text-zinc-300 transition hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-300"
          aria-label="Next"
          title="Next"
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={cycleRepeat}
          className={
            "rounded p-1 text-[14px] transition " +
            (repeat !== "off" ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300")
          }
          aria-label={`repeat ${repeat}`}
          title={`Repeat: ${repeat}`}
        >
          {repeat === "one" ? "🔂" : "🔁"}
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-zinc-500">🔈</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="flex-1 accent-zinc-300"
          aria-label="volume"
        />
        <span className="w-8 text-right text-[10px] text-zinc-500">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </aside>
  );
}
