"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { formatDuration } from "@/lib/format-duration";
import { coverUrl } from "@/lib/cover-url";
import { DownloadIcon, QueueIcon, RetryIcon } from "@/components/icons";
import { buildQueueTrack, PageLoading } from "./_shared";

export interface DownloadRow {
  ytVideoId: string;
  trackId: string | null;
  title: string;
  artist: string;
  status: "DOWNLOADING" | "READY" | "FAILED" | "PENDING";
  progressPct: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  duration: number;
  playable: boolean;
}

const POLL_MS = 1000;

function isActive(r: DownloadRow) {
  return r.status === "DOWNLOADING" || r.status === "PENDING";
}

/**
 * Server-backed download monitor. Progress comes from YtCacheEntry, so it
 * survives reloads and navigation — unlike the floating DownloadIndicator,
 * which only knows about a job the current tab started.
 *
 * Polls only while something is actually in flight.
 */
export function DownloadsPage() {
  const [rows, setRows] = useState<DownloadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { downloads: DownloadRow[] };
      setRows(json.downloads);
      setError(null);
      return json.downloads;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const fresh = await load();
      if (cancelled) return;
      // Keep polling only while something is still downloading — an idle
      // Downloads tab shouldn't hit the server once a second forever.
      if (fresh?.some(isActive)) {
        timer.current = setTimeout(() => void tick(), POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function onRetry(videoId: string) {
    await fetch(`/api/downloads/${encodeURIComponent(videoId)}/retry`, { method: "POST" });
    await load();
  }

  function queueOne(r: DownloadRow) {
    if (!r.trackId) return;
    usePlayerStore.getState().addToQueue(
      buildQueueTrack({
        id: r.trackId,
        title: r.title,
        duration: r.duration,
        artistName: r.artist,
        albumTitle: "YouTube",
        ytVideoId: r.ytVideoId,
      }),
    );
  }

  function queueAll(list: DownloadRow[]) {
    const tracks = list
      .filter((r) => r.trackId)
      .map((r) =>
        buildQueueTrack({
          id: r.trackId!,
          title: r.title,
          duration: r.duration,
          artistName: r.artist,
          albumTitle: "YouTube",
          ytVideoId: r.ytVideoId,
        }),
      );
    if (tracks.length > 0) usePlayerStore.getState().addManyToQueue(tracks);
  }

  if (rows === null && error) {
    return <div className="p-6 text-sm text-red-400">Couldn&apos;t load downloads: {error}</div>;
  }
  if (rows === null) return <PageLoading message="Loading downloads…" />;

  const active = rows.filter(isActive);
  const failed = rows.filter((r) => r.status === "FAILED");
  const done = rows.filter((r) => r.status === "READY" && r.playable);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-6">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <DownloadIcon size={14} /> Downloads
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-zinc-100">
          {active.length > 0 ? `${active.length} downloading` : "Nothing downloading"}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Finished songs stay here for 24 hours. Nothing is added to your queue automatically.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
        {rows.length === 0 && (
          <p className="py-12 text-center text-sm text-zinc-500">
            No downloads yet. Paste a YouTube playlist or mix link in Search to get started.
          </p>
        )}

        {active.length > 0 && (
          <Section title="Downloading">
            {active.map((r) => (
              <div key={r.ytVideoId} className="rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <Cover row={r} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-100">{r.title}</div>
                    <div className="truncate text-xs text-zinc-500">{r.artist}</div>
                  </div>
                  <div className="shrink-0 text-xs tabular-nums text-zinc-400">
                    {r.progressPct === null ? "starting…" : `${r.progressPct}%`}
                  </div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={
                      "h-full rounded-full bg-sky-500 transition-all " +
                      (r.progressPct === null ? "animate-pulse" : "")
                    }
                    style={{ width: `${r.progressPct ?? 8}%` }}
                  />
                </div>
              </div>
            ))}
          </Section>
        )}

        {failed.length > 0 && (
          <Section title="Failed">
            {failed.map((r) => (
              <div key={r.ytVideoId} className="flex items-center gap-3 rounded-lg px-3 py-2">
                <Cover row={r} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">{r.title}</div>
                  <div className="truncate text-xs text-red-400">
                    {r.errorMessage ?? "Download failed"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onRetry(r.ytVideoId)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                >
                  <RetryIcon size={13} /> Retry
                </button>
              </div>
            ))}
          </Section>
        )}

        {done.length > 0 && (
          <Section
            title="Finished · last 24 hours"
            action={
              <button
                type="button"
                onClick={() => queueAll(done)}
                className="flex items-center gap-1 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
              >
                <QueueIcon size={13} /> Add all to queue
              </button>
            }
          >
            {done.map((r) => (
              <div
                key={r.ytVideoId}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-zinc-800/50"
              >
                <Cover row={r} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">{r.title}</div>
                  <div className="truncate text-xs text-zinc-500">{r.artist}</div>
                </div>
                <div className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {formatDuration(r.duration)}
                </div>
                <button
                  type="button"
                  onClick={() => queueOne(r)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800 md:opacity-0 md:group-hover:opacity-100"
                >
                  <QueueIcon size={13} /> Add to queue
                </button>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Cover({ row }: { row: DownloadRow }) {
  const url = coverUrl(null, row.ytVideoId);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
  ) : (
    <div className="h-10 w-10 shrink-0 rounded bg-gradient-to-br from-zinc-700 to-zinc-900" />
  );
}
