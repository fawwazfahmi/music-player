"use client";

import { useEffect, useRef, useState } from "react";
import {
  addGenreToTrack,
  getAllGenres,
  getGenresForTrack,
  removeGenreFromTrack,
  type GenreSummary,
} from "@/server/actions/genres";
import { displayGenre } from "@/lib/genre";
import { CloseIcon } from "@/components/icons";

interface Props {
  trackId: string;
}

export function GenreEditor({ trackId }: Props) {
  const [genres, setGenres] = useState<GenreSummary[] | null>(null);
  const [allGenres, setAllGenres] = useState<GenreSummary[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getGenresForTrack(trackId), getAllGenres()]).then(([cur, all]) => {
      if (cancelled) return;
      setGenres(cur);
      setAllGenres(all);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  async function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const added = await addGenreToTrack(trackId, trimmed);
    if (added) {
      setGenres((prev) => {
        if (!prev) return [added];
        if (prev.some((g) => g.id === added.id)) return prev;
        return [...prev, added].sort((a, b) => a.name.localeCompare(b.name));
      });
      // Optimistically include in autocomplete options too.
      setAllGenres((prev) =>
        prev.some((g) => g.id === added.id)
          ? prev
          : [...prev, { ...added, trackCount: (added.trackCount ?? 0) + 1 }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
    }
    setInput("");
    setBusy(false);
    inputRef.current?.focus();
  }

  async function remove(genreId: string) {
    setBusy(true);
    await removeGenreFromTrack(trackId, genreId);
    setGenres((prev) => (prev ? prev.filter((g) => g.id !== genreId) : prev));
    setBusy(false);
  }

  const currentIds = new Set((genres ?? []).map((g) => g.id));
  const lowerInput = input.toLowerCase();
  const suggestions = allGenres
    .filter((g) => !currentIds.has(g.id) && (lowerInput === "" || g.name.includes(lowerInput)))
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Genres</h3>
        <span className="text-[10px] text-zinc-600">
          What kind of music · &ldquo;pop&rdquo;, &ldquo;r&amp;b&rdquo;, &ldquo;lo-fi&rdquo;
        </span>
      </div>

      {genres === null ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {genres.length === 0 && (
            <span className="text-xs text-zinc-600">No genres yet — add one below.</span>
          )}
          {genres.map((g) => (
            <span
              key={g.id}
              className="group flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300"
            >
              {displayGenre(g.name)}
              <button
                type="button"
                onClick={() => remove(g.id)}
                disabled={busy}
                aria-label={`Remove genre ${displayGenre(g.name)}`}
                className="ml-1 rounded-full p-0.5 text-sky-300/60 transition hover:bg-sky-500/20 hover:text-sky-200"
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(input);
        }}
        className="flex flex-col gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a genre…"
          disabled={busy}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => add(s.name)}
                disabled={busy}
                className="rounded-full border border-zinc-700/70 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-300"
              >
                {displayGenre(s.name)}
                <span className="ml-1 text-zinc-500">·</span>
                <span className="ml-1 text-zinc-500">{s.trackCount}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
