"use client";

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { usePartyStore } from "@/stores/party-store";
import { getEngine } from "@/audio/engine";
import { coverUrl } from "@/lib/cover-url";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";
import {
  HeartIcon,
  HeartOutlineIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  VolumeMuteIcon,
  VolumeUpIcon,
} from "@/components/icons";

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function PlayerBar() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const videoLoading = usePlayerStore((s) => s.videoLoading);
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

  // Hard-follow lock: when fawwaz is in a listening party, his player
  // controls are disabled — the broadcaster owns playback.
  const partyLocked = usePartyStore((s) => s.following);

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
    <div className="grid h-20 grid-cols-[1fr_2fr_1fr] items-center gap-4 border-t border-zinc-800/70 bg-zinc-950/95 px-4 backdrop-blur">
      {/* Left: now-playing info */}
      <div className="flex min-w-0 items-center gap-3">
        {(() => {
          const url = track ? coverUrl(track.coverArtHash, track.ytVideoId) : null;
          return url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-12 w-12 shrink-0 rounded object-cover shadow" />
          ) : (
            <div className="h-12 w-12 shrink-0 rounded bg-gradient-to-br from-zinc-700 to-zinc-900" />
          );
        })()}
        <div className="min-w-0 flex-1">
          {track ? (
            <>
              <div className="truncate text-sm font-medium text-zinc-100">{track.title}</div>
              <div className="truncate text-xs text-zinc-400">
                {videoLoading ? (
                  <span className="text-emerald-400">Loading video…</span>
                ) : (
                  track.artist
                )}
              </div>
            </>
          ) : (
            <>
              <div className="truncate text-sm text-zinc-500">Nothing playing</div>
              <div className="truncate text-xs text-zinc-600">Pick a song to start</div>
            </>
          )}
        </div>
        {hasTrack && (
          <button
            type="button"
            onClick={onToggleFav}
            className={
              "shrink-0 rounded-full p-2 transition " +
              (fav
                ? "text-red-500 hover:text-red-400"
                : "text-zinc-500 hover:text-zinc-200")
            }
            aria-label={fav ? "Unfavorite" : "Favorite"}
            title={fav ? "Unfavorite" : "Favorite"}
          >
            {fav ? <HeartIcon size={18} /> : <HeartOutlineIcon size={18} />}
          </button>
        )}
      </div>

      {/* Center: transport + scrub */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShuffle(!shuffle)}
            disabled={partyLocked}
            className={
              "rounded p-1.5 transition disabled:opacity-30 " +
              (shuffle ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-200")
            }
            aria-pressed={shuffle}
            title={partyLocked ? "Locked — listening party in progress" : "Shuffle"}
          >
            <ShuffleIcon size={16} />
          </button>
          <button
            type="button"
            onClick={prev}
            disabled={!hasTrack || partyLocked}
            className="rounded p-1.5 text-zinc-300 transition hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-300"
            aria-label="Previous"
          >
            <SkipPreviousIcon size={20} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!hasTrack || partyLocked}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-zinc-100"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!hasTrack || partyLocked}
            className="rounded p-1.5 text-zinc-300 transition hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-300"
            aria-label="Next"
          >
            <SkipNextIcon size={20} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            disabled={partyLocked}
            className={
              "rounded p-1.5 transition disabled:opacity-30 " +
              (repeat !== "off" ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-200")
            }
            aria-label={`repeat ${repeat}`}
            title={partyLocked ? "Locked — listening party in progress" : `Repeat: ${repeat}`}
          >
            {repeat === "one" ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-2 text-[10px] text-zinc-500">
          <span className="w-8 text-right tabular-nums">{formatTime(pos)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur))}
            value={Math.min(Math.floor(pos), Math.floor(dur))}
            onChange={(e) => seekTo(Number(e.target.value))}
            disabled={!hasTrack || partyLocked}
            className="flex-1 accent-zinc-300 disabled:opacity-40"
            aria-label="seek"
          />
          <span className="w-8 tabular-nums">{formatTime(dur)}</span>
        </div>
      </div>

      {/* Right: volume */}
      <div className="flex items-center justify-end gap-2 text-zinc-500">
        {volume === 0 ? <VolumeMuteIcon size={16} /> : <VolumeUpIcon size={16} />}
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="w-28 accent-zinc-300"
          aria-label="volume"
        />
      </div>
    </div>
  );
}
