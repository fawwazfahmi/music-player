"use client";

import { useEffect, useRef, useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { searchLibrary } from "@/server/actions/search";
import type { SearchResults } from "@/server/services/search";

interface SearchProps {
  selected?: number;
}

interface FlatRow {
  label: string;
  trailing?: string;
  action: () => void;
}

export function Search({ selected = 0 }: SearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ tracks: [], artists: [], albums: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const push = useIpodStore((s) => s.push);
  const [lastQuery, setLastQuery] = useState(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset results synchronously when query is cleared (state-compare pattern)
  if (lastQuery !== query) {
    setLastQuery(query);
    if (query.trim().length === 0) {
      setResults({ tracks: [], artists: [], albums: [] });
    }
  }

  // Debounced async fetch on non-empty query
  useEffect(() => {
    if (query.trim().length === 0) return;
    const handle = setTimeout(() => {
      void searchLibrary(query).then(setResults);
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const totalLocal = results.tracks.length + results.artists.length + results.albums.length;
  const showYtOption = query.trim().length > 0;
  const rowCount = totalLocal + (showYtOption ? 1 : 0);

  // Publish row count to Ipod via custom event bus
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: rowCount } }));
  }, [rowCount]);

  function flatRow(i: number): FlatRow | null {
    let idx = i;
    if (idx < results.tracks.length) {
      const t = results.tracks[idx]!;
      return {
        label: `♪ ${t.title}`,
        trailing: t.artistName,
        action: () => {
          usePlayerStore.getState().setQueue(
            [{
              id: t.id,
              title: t.title,
              duration: t.duration,
              artist: t.artistName,
              album: t.albumTitle ?? "",
            }],
            0,
          );
          push({ name: "nowPlaying" });
        },
      };
    }
    idx -= results.tracks.length;
    if (idx < results.artists.length) {
      const a = results.artists[idx]!;
      return { label: `👤 ${a.name}`, action: () => push({ name: "artistList" }) };
    }
    idx -= results.artists.length;
    if (idx < results.albums.length) {
      const al = results.albums[idx]!;
      return { label: `💿 ${al.title}`, trailing: al.artistName, action: () => push({ name: "albumList" }) };
    }
    idx -= results.albums.length;
    if (showYtOption && idx === 0) {
      return { label: `▶ Search YouTube for "${query}"`, action: () => push({ name: "ytPicker", query }) };
    }
    return null;
  }

  // Listen for ipod-select events
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ selected: number }>).detail;
      const row = flatRow(detail.selected);
      row?.action();
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, query]);

  const safeSel = Math.min(Math.max(0, selected), Math.max(0, rowCount - 1));

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Search
      </div>
      <div className="border-b border-black/10 px-2 py-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a song..."
          className="w-full rounded border border-black/20 bg-white/80 px-1 py-0.5 text-[11px] text-black outline-none"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {Array.from({ length: rowCount }, (_, i) => {
          const row = flatRow(i);
          if (!row) return null;
          return (
            <div
              key={i}
              className={
                "flex items-center justify-between border-b border-black/5 px-2 py-0.5 " +
                (i === safeSel
                  ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                  : "")
              }
            >
              <span className="truncate">{row.label}</span>
              {row.trailing && <span className="ml-2 text-[9px] opacity-70">{row.trailing}</span>}
            </div>
          );
        })}
        {query && totalLocal === 0 && !showYtOption && (
          <div className="grid h-20 place-items-center text-[10px] text-zinc-600">
            No matches.
          </div>
        )}
      </div>
    </div>
  );
}
