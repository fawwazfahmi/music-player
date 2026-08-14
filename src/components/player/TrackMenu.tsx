"use client";

import { useEffect, useRef, useState } from "react";
import {
  MoreIcon,
  PlayIcon,
  PlaylistIcon,
  QueueIcon,
  ChevronLeftIcon,
  DeleteIcon,
  AlbumIcon,
  NoteIcon,
} from "@/components/icons";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { deleteTrack } from "@/server/actions/library";
import { addToPlaylist, getPlaylists } from "@/server/actions/playlists";
import { transcribeTrack } from "@/server/actions/lyrics";
import { CoverPickerDialog } from "@/components/player/CoverPickerDialog";

interface Props {
  track: QueueTrack;
  /** Called after the track is successfully deleted, so pages can drop it
      from their local list. */
  onDeleted?: (trackId: string) => void;
  /** Called after the user picks a new cover, so the row showing this track
      can repaint without a refetch. */
  onCoverChanged?: (trackId: string, coverArtHash: string | null) => void;
}

type View = "main" | "playlists";

interface PlaylistLite {
  id: string;
  name: string;
}

export function TrackMenu({ track, onDeleted, onCoverChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [busy, setBusy] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistLite[] | null>(null);
  const [addedTo, setAddedTo] = useState<string | null>(null); // last playlist we added to
  const [coverOpen, setCoverOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Lazy-load playlists the first time the picker view is opened.
  useEffect(() => {
    if (view !== "playlists" || playlists !== null) return;
    let cancelled = false;
    void getPlaylists().then((r) => {
      if (cancelled) return;
      setPlaylists(r.map((p) => ({ id: p.id, name: p.name })));
    });
    return () => {
      cancelled = true;
    };
  }, [view, playlists]);

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    // The whole row is clickable to play; stop bubbling so the menu doesn't
    // also trigger playback.
    e.stopPropagation();
  }

  function handlePlayNext(e: React.MouseEvent) {
    stop(e);
    usePlayerStore.getState().playNext(track);
    setOpen(false);
  }

  function handleAddToQueue(e: React.MouseEvent) {
    stop(e);
    usePlayerStore.getState().addToQueue(track);
    setOpen(false);
  }

  function openPlaylistPicker(e: React.MouseEvent) {
    stop(e);
    setView("playlists");
  }

  async function handleAddToPlaylist(e: React.MouseEvent, pl: PlaylistLite) {
    stop(e);
    setBusy(true);
    try {
      await addToPlaylist(pl.id, track.id);
      setAddedTo(pl.id);
      // Short confirmation flash, then close.
      setTimeout(() => {
        setBusy(false);
        setOpen(false);
      }, 700);
    } catch (err) {
      console.error("addToPlaylist failed", err);
      setBusy(false);
    }
  }

  function openCoverPicker(e: React.MouseEvent) {
    stop(e);
    setOpen(false);
    setCoverOpen(true);
  }

  async function handleReTranscribe(e: React.MouseEvent) {
    stop(e);
    setTranscribing(true);
    setNote(null);
    try {
      await transcribeTrack(track.id);
      setNote("Lyrics re-transcribed");
      setTimeout(() => setOpen(false), 900);
    } catch (err) {
      // Most common cause is a track with no local audio file (still
      // downloading, or a pure-streaming row). Surface the reason rather than
      // failing silently.
      setNote(err instanceof Error ? err.message : "Re-transcribe failed");
    } finally {
      setTranscribing(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    stop(e);
    const ok = window.confirm(
      `Delete "${track.title}" from your library? The audio file will be removed from disk.`,
    );
    if (!ok) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await deleteTrack(track.id);
      usePlayerStore.getState().purgeTrack(track.id);
      onDeleted?.(track.id);
    } catch (err) {
      console.error("deleteTrack failed", err);
      window.alert("Failed to delete track. Check the console for details.");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative" onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          if (open) {
            setOpen(false);
            return;
          }
          // Reset here rather than in an effect on close: an event handler is
          // the right place for it, and it keeps the menu's state correct for
          // every path that closes it (backdrop click, Escape, selection).
          setView("main");
          setAddedTo(null);
          setNote(null);
          setOpen(true);
        }}
        aria-label="Track options"
        title="More"
        className={
          "rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-700/60 hover:text-zinc-100 " +
          (open ? "bg-zinc-700/60 text-zinc-100" : "")
        }
      >
        <MoreIcon size={16} />
      </button>
      {open && view === "main" && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl"
        >
          <MenuItem icon={<PlayIcon size={14} />} label="Play next" onClick={handlePlayNext} />
          <MenuItem
            icon={<QueueIcon size={14} />}
            label="Add to queue"
            onClick={handleAddToQueue}
          />
          <MenuItem
            icon={<PlaylistIcon size={14} />}
            label="Add to playlist…"
            onClick={openPlaylistPicker}
            trailing="›"
          />
          <div className="my-1 border-t border-zinc-800" />
          <MenuItem
            icon={<AlbumIcon size={14} />}
            label="Change cover…"
            onClick={openCoverPicker}
          />
          <MenuItem
            icon={<NoteIcon size={14} />}
            label={transcribing ? "Transcribing…" : "Re-transcribe"}
            onClick={handleReTranscribe}
            disabled={transcribing}
          />
          {note && (
            <p className="px-3 py-1 text-[11px] text-zinc-500">{note}</p>
          )}
          <div className="my-1 border-t border-zinc-800" />
          <MenuItem
            icon={<DeleteIcon size={14} />}
            label={busy ? "Deleting…" : "Delete"}
            onClick={handleDelete}
            danger
            disabled={busy}
          />
        </div>
      )}
      {open && view === "playlists" && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl"
        >
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              setView("main");
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ChevronLeftIcon size={14} />
            <span className="text-[11px] uppercase tracking-wider">Add to playlist</span>
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <div className="max-h-64 overflow-y-auto">
            {playlists === null ? (
              <div className="px-3 py-3 text-center text-xs text-zinc-500">Loading…</div>
            ) : playlists.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-zinc-500">
                No playlists yet
              </div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={(e) => handleAddToPlaylist(e, pl)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  <span className="truncate">{pl.name}</span>
                  {addedTo === pl.id && (
                    <span className="text-xs text-sky-400">Added ✓</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <CoverPickerDialog
        open={coverOpen}
        trackId={track.id}
        trackTitle={track.title}
        onClose={() => setCoverOpen(false)}
        onChanged={(hash) => {
          // Repaint the queue (player bar, queue panel, now-playing) and let
          // the list row showing this track update itself.
          usePlayerStore.getState().setTrackCoverArt(track.id, hash);
          onCoverChanged?.(track.id, hash);
        }}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition disabled:opacity-50 " +
        (danger
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
          : "text-zinc-200 hover:bg-zinc-800")
      }
    >
      <span className="opacity-70">{icon}</span>
      <span className="flex-1">{label}</span>
      {trailing && <span className="text-xs text-zinc-500">{trailing}</span>}
    </button>
  );
}
