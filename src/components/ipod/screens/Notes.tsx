"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { addNote, deleteNote, getNotesForTrack } from "@/server/actions/memory";
import { isFavorited, toggleFavorite } from "@/server/actions/favorites";

interface Props {
  trackId: string;
}

interface NoteRow {
  id: string;
  body: string;
  createdAt: Date;
}

function formatDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const yr = d.getFullYear();
  return `${m}/${day}/${yr}`;
}

export function Notes({ trackId }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [fav, setFav] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getNotesForTrack(trackId),
      isFavorited("TRACK", trackId),
    ]).then(([ns, f]) => {
      if (cancelled) return;
      setNotes(ns.map((n) => ({ id: n.id, body: n.body, createdAt: new Date(n.createdAt) })));
      setFav(f);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    inputRef.current?.focus();
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: 0 } }));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { id } = await addNote(trackId, body);
      setNotes((prev) => [{ id, body, createdAt: new Date() }, ...prev]);
      setDraft("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(noteId: string) {
    await deleteNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Notes
      </div>
      <div className="border-b border-black/10 px-2 py-1">
        <button
          type="button"
          onClick={() => {
            void toggleFavorite("TRACK", trackId).then((newFav) => {
              setFav(newFav);
              window.dispatchEvent(new CustomEvent("ipod-fav-changed"));
            });
          }}
          className={
            "w-full rounded border px-1.5 py-0.5 text-[10px] " +
            (fav
              ? "border-red-600 bg-red-50 text-red-700"
              : "border-black/30 bg-white/50 text-zinc-700")
          }
        >
          {fav ? "♥ Favorited" : "♡ Favorite this track"}
        </button>
      </div>
      <form onSubmit={onSubmit} className="border-b border-black/10 px-2 py-1">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a memory..."
          rows={2}
          className="w-full resize-none rounded border border-black/20 bg-white/80 px-1 py-0.5 text-[10px] text-black outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <p className="mt-0.5 text-[8px] text-zinc-600">Enter = save · Menu to leave</p>
      </form>
      <div className="flex-1 overflow-auto px-2 py-1">
        {notes.length === 0 && (
          <div className="text-center text-[9px] text-zinc-600">No notes yet.</div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="mb-1 border-b border-black/5 pb-1">
            <div className="flex items-start justify-between gap-1">
              <p className="flex-1 break-words text-[10px] leading-tight">{n.body}</p>
              <button
                type="button"
                onClick={() => void onDelete(n.id)}
                aria-label="delete"
                className="shrink-0 text-[9px] text-red-700 hover:text-red-900"
              >
                ⌫
              </button>
            </div>
            <p className="mt-0.5 text-[8px] text-zinc-500">{formatDate(n.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
