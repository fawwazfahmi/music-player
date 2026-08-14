"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { formatDuration } from "@/lib/format-duration";
import { DownloadIcon, PlaylistIcon } from "@/components/icons";
import { PageLoading } from "./_shared";

interface PreviewTrack {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

interface ListPreview {
  kind: "mix" | "playlist";
  listId: string;
  title: string;
  tracks: PreviewTrack[];
  defaultCheckedCount: number;
}

interface Props {
  url: string;
}

/**
 * Review-before-download screen for a YouTube playlist or mix.
 *
 * Selection is tracked by *index*, not videoId: a curated playlist may
 * legitimately contain the same video twice, and keying on videoId would tie
 * those rows together.
 */
export function YtPlaylistPickerPage({ url }: Props) {
  const [preview, setPreview] = useState<ListPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);

  // No state reset here: MainContent keys this component by url, so a
  // different list arrives as a fresh mount with fresh initial state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/yt-playlist/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const json = (await res.json().catch(() => null)) as
          | (ListPreview & { error?: string; message?: string })
          | null;
        if (!res.ok) {
          throw new Error(
            json?.error === "empty_list"
              ? "That link didn't resolve to any videos."
              : json?.message ?? json?.error ?? `HTTP ${res.status}`,
          );
        }
        if (cancelled || !json) return;
        setPreview(json);
        setChecked(new Set(json.tracks.map((_, i) => i).slice(0, json.defaultCheckedCount)));
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const toggle = useCallback((index: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selected = useMemo(
    () => (preview ? preview.tracks.filter((_, i) => checked.has(i)) : []),
    [preview, checked],
  );

  async function onDownload() {
    if (!preview || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/yt-playlist/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videos: selected }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`);
      }
      push({ name: "downloads" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !preview) {
    return (
      <div className="p-6 text-sm text-red-400">
        {error}
        <button type="button" onClick={() => pop()} className="ml-3 text-zinc-300 underline">
          Back
        </button>
      </div>
    );
  }

  if (!preview) return <PageLoading message="Reading the list from YouTube…" />;

  const isMix = preview.kind === "mix";
  const driftAt = preview.defaultCheckedCount;
  const showDrift = isMix && preview.tracks.length > driftAt;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
          <PlaylistIcon size={14} />
          {isMix ? "YouTube Mix" : "YouTube Playlist"}
        </div>
        <h1 className="mt-1 truncate text-xl font-bold text-zinc-100">
          {preview.title || "Untitled list"}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          {checked.size} of {preview.tracks.length} selected
          {isMix
            ? " · a mix is generated on the fly, so the further down you go the less it resembles what you pasted"
            : ""}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setChecked(new Set(preview.tracks.map((_, i) => i)))}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            Select none
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {preview.tracks.map((t, i) => (
          <div key={`${t.videoId}:${i}`}>
            {showDrift && i === driftAt && (
              <div className="my-3 flex items-center gap-3 px-2">
                <div className="h-px flex-1 bg-zinc-800" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                  below here the mix drifts from what you pasted
                </span>
                <div className="h-px flex-1 bg-zinc-800" />
              </div>
            )}
            <label
              className={
                "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-zinc-800/50 " +
                (checked.has(i) ? "" : "opacity-50")
              }
            >
              <input
                type="checkbox"
                checked={checked.has(i)}
                onChange={() => toggle(i)}
                className="h-4 w-4 shrink-0 accent-sky-500"
              />
              {t.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.thumbnail} alt="" className="h-10 w-16 rounded object-cover" />
              ) : (
                <div className="h-10 w-16 shrink-0 rounded bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-100">{t.title}</div>
                <div className="truncate text-xs text-zinc-500">{t.uploader}</div>
              </div>
              <div className="shrink-0 text-xs tabular-nums text-zinc-500">
                {formatDuration(t.duration)}
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800/50 bg-zinc-950/80 px-6 py-4">
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={submitting || selected.length === 0}
            onClick={() => void onDownload()}
            className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <DownloadIcon size={16} />
            {submitting
              ? "Starting…"
              : `Download ${selected.length} song${selected.length === 1 ? "" : "s"}`}
          </button>
          <p className="text-[11px] text-zinc-500">
            Downloads run in the background. Your queue and whatever is playing stay untouched.
          </p>
        </div>
      </div>
    </div>
  );
}
