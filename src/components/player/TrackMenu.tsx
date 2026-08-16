"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-media-query";
import {
  MoreIcon,
  PlayIcon,
  PlaylistIcon,
  QueueIcon,
  ChevronLeftIcon,
  DeleteIcon,
  AlbumIcon,
  NoteIcon,
  RetryIcon,
} from "@/components/icons";
import { usePlayerStore, type QueueTrack } from "@/stores/player-store";
import { useIpodStore } from "@/stores/ipod-store";
import { useMoodLearningStore } from "@/stores/mood-learning-store";
import { recordMoodSignal } from "@/server/actions/moods";
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
  /** Controlled open state. Supplied by rows that open the menu on long-press;
      omit for the plain click-the-button behaviour. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the ⋮ trigger. Used once the long-press gesture has been learned. */
  hideButton?: boolean;
  /** Show the "hold a song to open this" footer. The button is a teacher while
      it exists — without this line she would simply keep tapping it and never
      discover the gesture it is standing in for. */
  showLongPressTip?: boolean;
}

type View = "main" | "playlists";

interface PlaylistLite {
  id: string;
  name: string;
}

export function TrackMenu({
  track,
  onDeleted,
  onCoverChanged,
  open: controlledOpen,
  onOpenChange,
  hideButton = false,
  showLongPressTip = false,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>("main");
  const [busy, setBusy] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistLite[] | null>(null);
  const [addedTo, setAddedTo] = useState<string | null>(null); // last playlist we added to
  const [coverOpen, setCoverOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mood feedback lives here (not cluttering every row): shown only while a
  // mood session is active and this track belongs to it.
  const moodSessionId = useMoodLearningStore((s) => s.sessionId);
  const inMoodSession = useMoodLearningStore(
    (s) => !!s.sessionId && s.trackIds.has(track.id),
  );

  /**
   * Single way in and out, so controlled and uncontrolled behave identically.
   *
   * The sub-view reset happens on *close* rather than on open. It used to live
   * in the button's click handler, which no longer sees every open now that a
   * long-press can also trigger one — resetting on the way out covers both,
   * and needs no effect to watch the transition.
   */
  const setOpen = useCallback(
    (v: boolean) => {
      if (!v) {
        setView("main");
        setAddedTo(null);
        setNote(null);
      }
      if (onOpenChange) onOpenChange(v);
      else setUncontrolledOpen(v);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // The mobile sheet lives in a portal, so its DOM is not inside rootRef and
    // an outside-click check would close the menu the instant she touched it.
    // Its own backdrop does that job instead.
    if (!isMobile) document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile, setOpen]);

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

  function openNotes(e: React.MouseEvent) {
    stop(e);
    setOpen(false);
    useIpodStore.getState().push({ name: "notes", trackId: track.id });
  }

  function handleMoodFeedback(e: React.MouseEvent, verdict: "thumbUp" | "thumbDown") {
    stop(e);
    if (moodSessionId) {
      useMoodLearningStore.getState().markReacted(track.id);
      void recordMoodSignal(moodSessionId, track.id, verdict);
    }
    setOpen(false);
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

  // On a phone the menu is a bottom sheet in a portal, not a dropdown anchored
  // to the row. Two reasons: a 48px row has nowhere to put a 200px dropdown,
  // and the player bar's `backdrop-blur` creates a containing block for fixed
  // positioning, which would trap an absolutely-positioned menu inside it.
  //
  // The portal stays inside rootRef in the *React* tree, so the stopPropagation
  // on the wrapper still catches clicks and the row underneath never plays.
  function panel(body: React.ReactNode, width: string) {
    if (!isMobile) {
      return (
        <div
          role="menu"
          className={`absolute right-0 top-full z-50 mt-1 ${width} overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl`}
        >
          {body}
        </div>
      );
    }
    if (typeof document === "undefined") return null;
    return createPortal(
      <div className="fixed inset-0 z-[85] flex flex-col justify-end">
        <button
          type="button"
          aria-label="Close menu"
          className="absolute inset-0 bg-black/60"
          onClick={() => setOpen(false)}
        />
        <div
          role="menu"
          className="kw-safe-bottom kw-contain-scroll relative max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-zinc-700 bg-zinc-900 pb-4 pt-2 text-base shadow-2xl"
        >
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-zinc-700" />
          <p className="truncate px-4 pb-2 text-xs font-semibold text-zinc-500">
            {track.title}
          </p>
          {body}
          {showLongPressTip && (
            <p className="mx-3 mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
              Faster next time — <span className="font-bold">hold a song</span> to open this.
            </p>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div ref={rootRef} className="relative" onClick={stop} onKeyDown={stop}>
      {!hideButton && (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setOpen(!open);
          }}
          aria-label="Track options"
          aria-expanded={open}
          title="More"
          className={
            "rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-700/60 hover:text-zinc-100 " +
            (open ? "bg-zinc-700/60 text-zinc-100" : "")
          }
        >
          <MoreIcon size={16} />
        </button>
      )}
      {open && view === "main" && panel(
        <>
          {inMoodSession && (
            <>
              <MenuItem
                icon={<span className="text-[13px] leading-none">👍</span>}
                label="Fits my mood"
                onClick={(e) => handleMoodFeedback(e, "thumbUp")}
              />
              <MenuItem
                icon={<span className="text-[13px] leading-none">👎</span>}
                label="Not this mood"
                onClick={(e) => handleMoodFeedback(e, "thumbDown")}
              />
              <div className="my-1 border-t border-zinc-800" />
            </>
          )}
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
            icon={<NoteIcon size={14} />}
            label="Notes, tags & genres"
            onClick={openNotes}
          />
          <MenuItem
            icon={<AlbumIcon size={14} />}
            label="Change cover…"
            onClick={openCoverPicker}
          />
          <MenuItem
            icon={<RetryIcon size={14} />}
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
        </>,
        "w-48",
      )}
      {open && view === "playlists" && panel(
        <>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              setView("main");
            }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 md:px-3 md:py-1.5"
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
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50 md:px-3 md:py-1.5"
                >
                  <span className="truncate">{pl.name}</span>
                  {addedTo === pl.id && (
                    <span className="text-xs text-sky-400">Added ✓</span>
                  )}
                </button>
              ))
            )}
          </div>
        </>,
        "w-56",
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
        // Roomier on touch: 1.5 units of vertical padding is a ~26px target,
        // well under the 44px Apple asks for and a reliable way to mis-tap
        // Delete when you meant Re-transcribe.
        "flex w-full items-center gap-3 px-4 py-3 text-left transition disabled:opacity-50 md:gap-2 md:px-3 md:py-1.5 " +
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
