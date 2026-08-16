"use client";

import { useState } from "react";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";
import { coverUrl, resolveTrackCoverHash } from "@/lib/cover-url";
import { PlayIcon } from "@/components/icons";
import { TrackMenu } from "@/components/player/TrackMenu";
import { useIsTouch } from "@/hooks/use-media-query";
import { useLongPress } from "@/hooks/use-long-press";
import { useMenuPrefs } from "@/hooks/use-menu-prefs";
import { LongPressCoach } from "@/components/mobile/LongPressCoach";

interface SongRowProps {
  track: QueueTrack;
  index: number;
  onPlay: (index: number) => void;
  /** Called after the track has been removed from the library so the parent
      page can drop it from its local list. */
  onDeleted?: (trackId: string) => void;
  showAlbum?: boolean;
  /** Optional controls rendered just before the ⋮ menu (e.g. mood thumbs). */
  actions?: React.ReactNode;
}

export function SongRow({ track, index, onPlay, onDeleted, showAlbum = true, actions }: SongRowProps) {
  const currentTrackId = usePlayerStore((s) => s.queue[s.currentIndex]?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const active = currentTrackId === track.id;
  // Set when the user picks a new cover from this row's menu, so the art
  // updates immediately without the parent page refetching its list.
  // `undefined` means "no local change"; `null` means "reset to default".
  const [coverOverride, setCoverOverride] = useState<string | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  const isTouch = useIsTouch();
  const { showButton, showTip, recordLongPress } = useMenuPrefs(isTouch);

  // Press and hold opens the menu. Enabled only where hover doesn't exist —
  // on a mouse the ⋮ appears on hover and always has, and hijacking a
  // right-click there would be worse than what it replaces.
  const { handlers, pressing, consumedRef } = useLongPress(
    () => {
      setMenuOpen(true);
      recordLongPress();
    },
    { enabled: isTouch },
  );

  function activate() {
    // A touch that opened the menu still emits a click on release. Without
    // this the track would start playing underneath the menu she just opened.
    if (consumedRef.current) {
      consumedRef.current = false;
      return;
    }
    onPlay(index);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(index);
        }
      }}
      {...handlers}
      className={
        // Mobile is a plain flex row: track number, album and duration columns
        // are dropped, and album/duration reappear on the artist line so no
        // information is actually lost. Above `md` the original six-column
        // grid is restored untouched.
        "group kw-pressable flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition " +
        "md:grid md:grid-cols-[36px_36px_minmax(0,1fr)_minmax(0,1fr)_48px_32px] " +
        "hover:bg-zinc-800/50 " +
        (active ? "bg-zinc-800/40 text-sky-400 " : "") +
        // Hold feedback. iOS Safari has no vibration API, so the confirmation
        // that a press registered has to be something she can see.
        (pressing ? "scale-[0.97] bg-sky-500/10" : "")
      }
    >
      <div className="hidden text-right text-xs text-zinc-500 tabular-nums md:block">
        <span className="group-hover:hidden">{active && isPlaying ? "♪" : index + 1}</span>
        <span className="hidden group-hover:inline">
          <PlayIcon size={14} />
        </span>
      </div>
      {(() => {
        const hash = coverOverride !== undefined ? coverOverride : track.coverArtHash;
        const url = coverUrl(hash, track.ytVideoId);
        return url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-11 w-11 shrink-0 rounded object-cover md:h-9 md:w-9" />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded bg-gradient-to-br from-zinc-700 to-zinc-900 md:h-9 md:w-9" />
        );
      })()}
      <div className="min-w-0 flex-1">
        <div className={"truncate text-sm font-medium " + (active ? "" : "text-zinc-100")}>
          {track.title}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {track.artist}
          <span className="md:hidden">
            {showAlbum && track.album ? ` · ${track.album}` : ""}
            {` · ${formatDuration(track.duration)}`}
          </span>
        </div>
      </div>
      {showAlbum ? (
        <div className="hidden truncate text-xs text-zinc-500 md:block">{track.album}</div>
      ) : (
        <div className="hidden md:block" />
      )}
      <div className="hidden text-right text-xs text-zinc-500 tabular-nums md:block">
        {formatDuration(track.duration)}
      </div>
      {actions && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
      {/* Kebab — on a mouse it fades in on hover, as always. On touch it is a
          teacher that retires: visible until the long-press has been used a few
          times, then gone. The menu stops its own click bubbling so opening it
          never starts the track. */}
      <div className="shrink-0 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <TrackMenu
          track={track}
          onDeleted={onDeleted}
          onCoverChanged={(_id, hash) => setCoverOverride(hash)}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          hideButton={!showButton}
          showLongPressTip={showTip}
        />
      </div>
      {/* Rendered by the first row only, so exactly one coach mark appears
          whenever a song list is on screen — no page has to remember to mount
          it, and no two pages can double it up. */}
      {index === 0 && <LongPressCoach />}
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

/** Lightweight loading placeholder shown while a list page's initial fetch
    is in flight. Keeps pages from rendering the empty-state "no items"
    message during the data-loading window after a download finishes (when
    the server is briefly busy with metadata enrichment). */
export function PageLoading({ message = "Loading…" }: { message?: string } = {}) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-sky-500/70" />
      <span>{message}</span>
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
  /** Album-level art. Historic field name — several callers pass it meaning
      the album's cover, so it must not be mistaken for a per-track override. */
  coverArtHash?: string | null;
  /** Per-track override chosen in the cover picker. Wins over album art. */
  trackCoverArtHash?: string | null;
  ytVideoId?: string | null;
}): QueueTrack {
  return {
    id: t.id,
    title: t.title,
    duration: t.duration,
    artist: t.primaryArtist?.name ?? t.artistName ?? "Unknown",
    album: t.album?.title ?? t.albumTitle ?? "",
    coverArtHash: resolveTrackCoverHash({
      trackCoverArtHash: t.trackCoverArtHash,
      albumCoverArtHash: t.album?.coverArtHash,
      legacyCoverArtHash: t.coverArtHash,
    }),
    ytVideoId: t.ytVideoId ?? null,
  };
}
