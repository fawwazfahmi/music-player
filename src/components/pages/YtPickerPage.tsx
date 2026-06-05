"use client";

import { useEffect, useState } from "react";
import { searchYt, selectYtResult } from "@/server/actions/search";
import type { YtSearchResult } from "@/server/services/yt-service";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { useDownloadStore } from "@/stores/download-store";
import { formatDuration } from "@/lib/format-duration";
import { PlayIcon } from "@/components/icons";
import { buildQueueTrack } from "./_shared";

interface Props {
  query: string;
}

export function YtPickerPage({ query }: Props) {
  const [results, setResults] = useState<YtSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<YtSearchResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void searchYt(query)
      .then((r) => !cancelled && setResults(r))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    if (!downloading) return;
    const t0 = Date.now();
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(i);
  }, [downloading]);

  async function onPick(r: YtSearchResult) {
    setDownloading(r);
    // Also publish to the global download store so the floating toast persists
    // if the user navigates away from this page.
    useDownloadStore.getState().start({
      id: r.videoId,
      title: r.title,
      artist: r.uploader,
    });
    try {
      const { trackId } = await selectYtResult(r);
      usePlayerStore.getState().setQueue(
        [
          buildQueueTrack({
            id: trackId,
            title: r.title,
            duration: r.duration,
            artistName: r.uploader,
            albumTitle: "YouTube",
            ytVideoId: r.videoId,
          }),
        ],
        0,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
      useDownloadStore.getState().finish();
    }
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        YT error: {error}
        <button
          type="button"
          onClick={() => push({ name: "search" })}
          className="ml-3 text-zinc-300 underline"
        >
          Back to search
        </button>
      </div>
    );
  }

  if (downloading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="h-32 w-32 animate-pulse rounded bg-gradient-to-br from-emerald-700 to-emerald-900 shadow-lg" />
        <h2 className="text-lg font-bold text-zinc-100">{downloading.title}</h2>
        <p className="text-sm text-zinc-400">{downloading.uploader}</p>
        <p className="text-xs text-zinc-500">Downloading… {elapsed}s (usually 15–30s)</p>
      </div>
    );
  }

  if (results === null) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500">
        Searching YouTube for &ldquo;{query}&rdquo;…
      </div>
    );
  }

  if (results.length === 0) {
    return <div className="p-6 text-center text-sm text-zinc-500">No YouTube results.</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">YouTube · {query}</p>
        <h1 className="mt-1 text-xl font-bold text-zinc-100">Pick a version</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {results.map((r) => (
          <button
            key={r.videoId}
            type="button"
            onClick={() => onPick(r)}
            className="group flex w-full items-center gap-4 rounded-lg p-3 text-left transition hover:bg-zinc-800/50"
          >
            {r.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.thumbnail}
                alt=""
                className="h-12 w-20 rounded object-cover"
              />
            ) : (
              <div className="h-12 w-20 rounded bg-zinc-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">{r.title}</div>
              <div className="truncate text-xs text-zinc-500">{r.uploader}</div>
            </div>
            <div className="text-xs text-zinc-500 tabular-nums">{formatDuration(r.duration)}</div>
            <div className="text-zinc-500 group-hover:text-emerald-400">
              <PlayIcon size={20} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
