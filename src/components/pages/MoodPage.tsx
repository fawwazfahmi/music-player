"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getMoods,
  startMoodSession,
  getMoodYtSuggestions,
  adoptYtPickIntoMood,
  type MoodChip,
} from "@/server/actions/moods";
import type { MoodSessionResult } from "@/server/services/mood-session";
import type { YtSearchResult } from "@/server/services/yt-service";
import { useIdentity } from "@/hooks/use-identity";
import { usePlayerStore } from "@/stores/player-store";
import { useMoodLearningStore } from "@/stores/mood-learning-store";
import { useDownloadStore } from "@/stores/download-store";
import { formatDuration } from "@/lib/format-duration";
import { PageHeader, PageLoading, SongRow, buildQueueTrack } from "./_shared";
import { PlayIcon } from "@/components/icons";

export function MoodPage() {
  const identity = useIdentity();
  const [moods, setMoods] = useState<MoodChip[] | null>(null);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MoodSessionResult | null>(null);
  const [ytPicks, setYtPicks] = useState<YtSearchResult[] | null>(null);
  const [kept, setKept] = useState<Record<string, "keeping" | "kept">>({});

  useEffect(() => {
    let cancelled = false;
    void getMoods().then((m) => {
      if (!cancelled) setMoods(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function generate(input: { moodId?: string; freeText?: string }) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await startMoodSession({ ...input, limit: 30 });
      setResult(r);
      setYtPicks(null);
      setKept({});
      // Fresh YouTube picks load lazily so the library playlist is instant.
      void getMoodYtSuggestions(r.sessionId).then((picks) => setYtPicks(picks));
      // Drop straight into a playing playlist, like starting any playlist.
      if (r.tracks.length > 0) {
        const queue = r.tracks.map((t) =>
          buildQueueTrack({
            id: t.id,
            title: t.title,
            duration: t.duration,
            artistName: t.artist,
            albumTitle: t.album,
            coverArtHash: t.coverArtHash,
            ytVideoId: t.ytVideoId,
          }),
        );
        usePlayerStore.getState().setQueue(queue, 0);
      }
      // Mark this as the active mood session so playback feeds learning.
      useMoodLearningStore.getState().setSession(
        r.sessionId,
        r.tracks.map((t) => t.id),
      );
    } finally {
      setBusy(false);
    }
  }

  // Keep a YouTube fresh pick: download it into the library (existing flow),
  // then adopt it into this mood so it's remembered.
  async function keep(pick: YtSearchResult) {
    if (!result || kept[pick.videoId]) return;
    setKept((prev) => ({ ...prev, [pick.videoId]: "keeping" }));
    try {
      const res = await fetch("/api/yt-download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pick),
      });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const { trackId, status } = (await res.json()) as {
        trackId: string;
        status: "READY" | "DOWNLOADING";
      };
      void adoptYtPickIntoMood(result.sessionId, trackId);

      const queueTrack = buildQueueTrack({
        id: trackId,
        title: pick.title,
        duration: pick.duration,
        artistName: pick.uploader,
        albumTitle: "YouTube",
        ytVideoId: pick.videoId,
      });
      if (status === "READY") {
        usePlayerStore.getState().addToQueue(queueTrack);
      } else {
        useDownloadStore.getState().start({
          id: pick.videoId,
          title: pick.title,
          artist: pick.uploader,
          trackId,
          queueTrack,
        });
      }
      setKept((prev) => ({ ...prev, [pick.videoId]: "kept" }));
    } catch {
      setKept((prev) => {
        const next = { ...prev };
        delete next[pick.videoId];
        return next;
      });
    }
  }

  const name = identity ? identity[0]!.toUpperCase() + identity.slice(1) : null;

  const queue =
    result?.tracks.map((t) =>
      buildQueueTrack({
        id: t.id,
        title: t.title,
        duration: t.duration,
        artistName: t.artist,
        albumTitle: t.album,
        coverArtHash: t.coverArtHash,
        ytVideoId: t.ytVideoId,
      }),
    ) ?? [];

  function play(index: number) {
    usePlayerStore.getState().setQueue(queue, index);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Mood" subtitle="How are you feeling?" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-1 text-xl font-bold text-zinc-100">
            How are you feeling{name ? `, ${name}` : ""}?
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Pick a mood, or say it in your own words — Kyowave builds you a playlist.
          </p>

          {moods === null ? (
            <PageLoading message="Loading moods…" />
          ) : (
            <div className="mb-4 flex flex-wrap gap-2">
              {moods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void generate({ moodId: m.id })}
                  className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300 disabled:opacity-40"
                >
                  {m.emoji && <span className="text-base">{m.emoji}</span>}
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const text = freeText.trim();
              if (text) void generate({ freeText: text });
            }}
            className="mb-6 flex gap-2"
          >
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="…or say it in your own words (e.g. rainy sunday)"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || freeText.trim().length === 0}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:opacity-40"
            >
              {busy ? "…" : "Go"}
            </button>
          </form>

          {busy && (
            <div className="flex items-center gap-2 py-6 text-sm text-sky-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
              Reading the room…
            </div>
          )}

          {result && !busy && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Your {result.moodLabel} mix
                  </p>
                  <p className="text-sm text-zinc-500">
                    {queue.length} track{queue.length === 1 ? "" : "s"}
                  </p>
                </div>
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => play(0)}
                    className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400"
                  >
                    <PlayIcon size={16} /> Play
                  </button>
                )}
              </div>
              {queue.length === 0 ? (
                <p className="px-3 py-12 text-center text-sm text-zinc-500">
                  Nothing matched that mood yet — try another, or seed more of your library.
                </p>
              ) : (
                queue.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={play} />)
              )}

              {ytPicks && ytPicks.length > 0 && (
                <div className="mt-6">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Fresh from YouTube
                  </p>
                  <p className="mb-3 text-xs text-zinc-600">
                    Not in your library yet — keep one and it downloads in for good.
                  </p>
                  {ytPicks.map((p) => (
                    <div
                      key={p.videoId}
                      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-zinc-800/40"
                    >
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-300">
                        YT
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-zinc-100">{p.title}</div>
                        <div className="truncate text-xs text-zinc-400">
                          {p.uploader} · {formatDuration(p.duration)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!!kept[p.videoId]}
                        onClick={() => void keep(p)}
                        className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 transition hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-300 disabled:opacity-50"
                      >
                        {kept[p.videoId] === "kept"
                          ? "Kept ✓"
                          : kept[p.videoId] === "keeping"
                            ? "Keeping…"
                            : "＋ Keep"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
