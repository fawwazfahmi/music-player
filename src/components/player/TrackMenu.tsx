"use client";

import { useEffect, useRef, useState } from "react";
import { MoreIcon, PlayIcon, QueueIcon, DeleteIcon } from "@/components/icons";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { deleteTrack } from "@/server/actions/library";

interface Props {
  track: QueueTrack;
  /** Called after the track is successfully deleted, so pages can drop it
      from their local list. */
  onDeleted?: (trackId: string) => void;
}

export function TrackMenu({ track, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
          setOpen((o) => !o);
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
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl"
        >
          <MenuItem icon={<PlayIcon size={14} />} label="Play next" onClick={handlePlayNext} />
          <MenuItem
            icon={<QueueIcon size={14} />}
            label="Add to queue"
            onClick={handleAddToQueue}
          />
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
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
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
      <span>{label}</span>
    </button>
  );
}
