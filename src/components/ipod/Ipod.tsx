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
        if (rowCount > 0) {
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

  const currentTrack = player.queue[player.currentIndex] ?? null;
  const showNowPlayingControls = current.name === "nowPlaying" && currentTrack;

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
        <div data-selected={selected} data-row-count={rowCount}>
          <Chassis screen={<Screen selected={selected} />} wheel={<ClickWheel onEvent={handleEvent} />} />
        </div>
        {showNowPlayingControls && (
          <div className="md:pt-12">
            <NowPlayingControls trackId={currentTrack.id} />
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Selected: {selected} / {Math.max(0, rowCount - 1)}
      </p>
    </main>
  );
}

function NowPlayingControls({ trackId }: { trackId: string }) {
  const [fav, setFav] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isFavorited("TRACK", trackId).then((f) => {
      if (!cancelled) setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    function handler() {
      void isFavorited("TRACK", trackId).then(setFav);
    }
    window.addEventListener("ipod-fav-changed", handler);
    return () => window.removeEventListener("ipod-fav-changed", handler);
  }, [trackId]);

  async function onToggle() {
    const newFav = await toggleFavorite("TRACK", trackId);
    setFav(newFav);
    window.dispatchEvent(new CustomEvent("ipod-fav-changed"));
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onToggle}
        className={
          "rounded-full border px-4 py-1.5 text-[12px] font-medium transition " +
          (fav
            ? "border-red-600 bg-red-500/10 text-red-400 hover:bg-red-500/20"
            : "border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700")
        }
        aria-label={fav ? "Unfavorite" : "Favorite"}
      >
        {fav ? "♥ Favorited" : "♡ Favorite"}
      </button>
      <p className="text-[10px] text-zinc-500">Center button → Notes</p>
    </div>
  );
}
