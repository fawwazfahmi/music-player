"use client";

import { useEffect, useState } from "react";
import { searchYt } from "@/server/actions/search";
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
  const [picked, setPicked] = useState<string | null>(null); // videoId user just picked
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

  async function onPick(r: YtSearchResult) {
    setPicked(r.videoId);
    setError(null);
    try {
      // Build the QueueTrack from what we already know — title / artist /
      // duration / videoId. We hand it off to the download-store; the
      // polling effect in AppShell will call setQueue(...) with it the
      // moment the file is ready.
      const queueTrack = buildQueueTrack({
        id: "pending", // overwritten below once we know the real trackId
        title: r.title,
        duration: r.duration,
        artistName: r.uploader,
        albumTitle: "YouTube",
        ytVideoId: r.videoId,
      });

      const res = await fetch("/api/yt-download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(r),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Download failed (HTTP ${res.status})`);
      }
      const { trackId, status } = (await res.json()) as {
        trackId: string;
        status: "READY" | "DOWNLOADING";
      };

      // Track row exists from this point — give it the real id.
      queueTrack.id = trackId;

      if (status === "READY") {
        // Already cached on disk — start playback immediately.
        usePlayerStore.getState().setQueue([queueTrack], 0);
      } else {
        // Hand off to the background polling flow; setQueue happens when
        // the file lands. Floating DownloadIndicator shows progress.
        useDownloadStore.getState().start({
          id: r.videoId,
          title: r.title,
          artist: r.uploader,
          trackId,
          queueTrack,
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicked(null);
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
        <p className="mt-1 text-xs text-zinc-600">
          Playback starts automatically once the download finishes — feel free
          to keep browsing.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {results.map((r) => {
          const isPicking = picked === r.videoId;
          return (
            <button
              key={r.videoId}
              type="button"
              onClick={() => onPick(r)}
              disabled={isPicking}
              className="group flex w-full items-center gap-4 rounded-lg p-3 text-left transition hover:bg-zinc-800/50 disabled:cursor-wait disabled:opacity-60"
            >
              {r.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.thumbnail} alt="" className="h-12 w-20 rounded object-cover" />
              ) : (
                <div className="h-12 w-20 rounded bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{r.title}</div>
                <div className="truncate text-xs text-zinc-500">{r.uploader}</div>
              </div>
              <div className="text-xs text-zinc-500 tabular-nums">{formatDuration(r.duration)}</div>
              <div className="text-zinc-500 group-hover:text-emerald-400">
                {isPicking ? (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400">
                    Queueing…
                  </span>
                ) : (
                  <PlayIcon size={20} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
