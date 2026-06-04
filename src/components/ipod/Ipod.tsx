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

const HOLD_MENU_MS = 600;

export function Ipod() {
  const current = useIpodStore((s) => s.current());
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);
  const toRoot = useIpodStore((s) => s.toRoot);

  const player = usePlayerStore();
  const [selected, setSelected] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const menuDownAt = useRef<number | null>(null);

  // Reset selection + recompute row count when screen changes
  useEffect(() => {
    setSelected(0);
    void (async () => {
      if (current.name === "home") setRowCount(2);
      else if (current.name === "musicSub") setRowCount(3);
      else if (current.name === "artistList") setRowCount((await getArtists()).length);
      else if (current.name === "albumList") setRowCount((await getAllAlbums()).length);
      else if (current.name === "songList") setRowCount((await getAllSongs()).length);
      else setRowCount(0);
    })();
  }, [current.name]);

  // Audio engine: load track when currentIndex changes
  useEffect(() => {
    const engine = getEngine();
    const track = player.queue[player.currentIndex];
    if (!track) return;
    engine.loadTrack(track.id);
    updateMediaMetadata(track);
    if (player.isPlaying) void engine.play();
  }, [player.currentIndex, player.queue]);

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

  // Time tick → store
  useEffect(() => {
    const engine = getEngine();
    return engine.on("timeupdate", () => {
      usePlayerStore.getState().setPosition(engine.getCurrentTime());
    });
  }, []);

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
      else if (sel === 1) push({ name: "nowPlaying" });
    } else if (current.name === "musicSub") {
      if (sel === 0) push({ name: "artistList" });
      else if (sel === 1) push({ name: "albumList" });
      else if (sel === 2) push({ name: "songList" });
    } else if (current.name === "songList") {
      const songs = await getAllSongs();
      const queue = songs.map((s) => ({
        id: s.id,
        title: s.title,
        duration: s.duration,
        artist: s.primaryArtist.name,
        album: s.album?.title ?? "",
        coverArtPath: s.album?.coverArtPath ?? null,
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

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <div data-selected={selected} data-row-count={rowCount}>
        <Chassis screen={<Screen selected={selected} />} wheel={<ClickWheel onEvent={handleEvent} />} />
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Selected: {selected} / {Math.max(0, rowCount - 1)}
      </p>
    </main>
  );
}
