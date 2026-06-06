"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { addNote, deleteNote, getNotesForTrack } from "@/server/actions/memory";
import { DeleteIcon, NoteIcon } from "@/components/icons";
import { TagEditor } from "@/components/tags/TagEditor";
import { PageHeader } from "./_shared";

interface Props {
  trackId: string;
}

interface NoteRow {
  id: string;
  body: string;
  createdAt: Date;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString();
}

export function NotesPage({ trackId }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getNotesForTrack(trackId).then((ns) => {
      if (cancelled) return;
      setNotes(ns.map((n) => ({ id: n.id, body: n.body, createdAt: new Date(n.createdAt) })));
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    inputRef.current?.focus();
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
      <PageHeader title="Notes" subtitle="Memory journal" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto mb-6 max-w-2xl">
          <TagEditor trackId={trackId} />
        </div>
        <form onSubmit={onSubmit} className="mx-auto max-w-2xl">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a memory…"
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSubmit(e as unknown as FormEvent);
              }
            }}
          />
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>Enter = save · Shift+Enter = newline</span>
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="rounded-full bg-emerald-500 px-4 py-1 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              {busy ? "…" : "Save"}
            </button>
          </div>
        </form>

        <div className="mx-auto mt-6 max-w-2xl space-y-3">
          {notes.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-zinc-500">
              <NoteIcon size={36} />
              <p className="text-sm">No notes yet</p>
            </div>
          )}
          {notes.map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-4"
            >
              <div className="flex-1">
                <p className="whitespace-pre-wrap text-sm text-zinc-100">{n.body}</p>
                <p className="mt-1 text-xs text-zinc-500">{formatDate(n.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(n.id)}
                className="shrink-0 rounded p-1 text-zinc-500 transition hover:text-red-400"
                aria-label="Delete note"
              >
                <DeleteIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
