"use client";

import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";
import { PlayIcon } from "@/components/icons";
import { TrackMenu } from "@/components/player/TrackMenu";

interface SongRowProps {
  track: QueueTrack;
  index: number;
  onPlay: (index: number) => void;
  /** Called after the track has been removed from the library so the parent
      page can drop it from its local list. */
  onDeleted?: (trackId: string) => void;
  showAlbum?: boolean;
}

export function SongRow({ track, index, onPlay, onDeleted, showAlbum = true }: SongRowProps) {
  const currentTrackId = usePlayerStore((s) => s.queue[s.currentIndex]?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = currentTrackId === track.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(index);
        }
      }}
      className={
        "group grid cursor-pointer grid-cols-[36px_36px_minmax(0,1fr)_minmax(0,1fr)_48px_32px] items-center gap-3 rounded-md px-3 py-2 transition hover:bg-zinc-800/50 " +
        (active ? "bg-zinc-800/40 text-emerald-400" : "")
      }
    >
      <div className="text-right text-xs text-zinc-500 tabular-nums">
        <span className="group-hover:hidden">{active && isPlaying ? "♪" : index + 1}</span>
        <span className="hidden group-hover:inline">
          <PlayIcon size={14} />
        </span>
      </div>
      {track.coverArtHash ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/art/${track.coverArtHash}`}
          alt=""
          className="h-9 w-9 rounded object-cover"
        />
      ) : (
        <div className="h-9 w-9 rounded bg-gradient-to-br from-zinc-700 to-zinc-900" />
      )}
      <div className="min-w-0">
        <div className={"truncate text-sm font-medium " + (active ? "" : "text-zinc-100")}>
          {track.title}
        </div>
        <div className="truncate text-xs text-zinc-400">{track.artist}</div>
      </div>
      {showAlbum ? (
        <div className="truncate text-xs text-zinc-500">{track.album}</div>
      ) : (
        <div />
      )}
      <div className="text-right text-xs text-zinc-500 tabular-nums">
        {formatDuration(track.duration)}
      </div>
      {/* Kebab menu — invisible until row hover or menu open. The menu component
          handles its own click-stopPropagation so it doesn't trigger playback. */}
      <div className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <TrackMenu track={track} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  cover,
  actions,
}: {
  title: string;
  subtitle?: string;
  cover?: string | null;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end gap-6 border-b border-zinc-800/50 px-6 py-8">
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt=""
          className="h-32 w-32 rounded-lg object-cover shadow-2xl ring-1 ring-zinc-800"
        />
      )}
      <div className="min-w-0 flex-1">
        {subtitle && (
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {subtitle}
          </div>
        )}
        <h1 className="mt-1 truncate text-3xl font-extrabold tracking-tight text-zinc-100">
          {title}
        </h1>
        {actions && <div className="mt-3 flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function buildQueueTrack(t: {
  id: string;
  title: string;
  duration: number;
  primaryArtist?: { name: string } | null;
  artistName?: string;
  album?: { title?: string; coverArtHash?: string | null } | null;
  albumTitle?: string;
  coverArtHash?: string | null;
  ytVideoId?: string | null;
}): QueueTrack {
  return {
    id: t.id,
    title: t.title,
    duration: t.duration,
    artist: t.primaryArtist?.name ?? t.artistName ?? "Unknown",
    album: t.album?.title ?? t.albumTitle ?? "",
    coverArtHash: t.album?.coverArtHash ?? t.coverArtHash ?? null,
    ytVideoId: t.ytVideoId ?? null,
  };
}
