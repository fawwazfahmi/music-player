"use client";

import { useEffect, useState } from "react";
import { getAllGenres, type GenreSummary } from "@/server/actions/genres";
import { displayGenre } from "@/lib/genre";
import { useIpodStore } from "@/stores/ipod-store";
import { PageHeader, PageLoading } from "./_shared";

export function GenresPage() {
  const [genres, setGenres] = useState<GenreSummary[] | null>(null);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getAllGenres().then((r) => {
      if (!cancelled) setGenres(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Genres" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {genres === null ? (
          <PageLoading message="Loading genres…" />
        ) : genres.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            No genres yet — they fill in as your library is enriched, or run the genre
            backfill.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => push({ name: "genreDetail", genreId: g.id })}
                className="group flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
              >
                <span>{displayGenre(g.name)}</span>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] tabular-nums text-zinc-400 group-hover:bg-sky-500/20 group-hover:text-sky-300">
                  {g.trackCount}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
