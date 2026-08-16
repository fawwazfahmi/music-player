"use client";

import { useEffect, useState } from "react";
import { getTrackAudioFeatures, type AudioFeaturesView } from "@/server/actions/audio";

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-zinc-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-zinc-500">{pct}</span>
    </div>
  );
}

export function AudioFeaturesCard({ trackId }: { trackId: string }) {
  const [data, setData] = useState<AudioFeaturesView | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    void getTrackAudioFeatures(trackId).then((r) => {
      if (!cancelled) setData(r);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  if (data === "loading") return null;

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Audio</h3>
        <span className="text-[10px] text-zinc-600">What the sound actually is</span>
      </div>

      {data === null ? (
        <p className="text-xs text-zinc-600">
          Not analyzed yet — runs automatically after download, or via the audio backfill.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-200">
            {data.tempo != null && (
              <span>
                <span className="text-zinc-500">Tempo</span> {Math.round(data.tempo)} BPM
              </span>
            )}
            {data.key && (
              <span>
                <span className="text-zinc-500">Key</span> {data.key}
                {data.scale ? ` ${data.scale}` : ""}
              </span>
            )}
            {data.danceability != null && (
              <span>
                <span className="text-zinc-500">Danceable</span> {Math.round(data.danceability * 100)}%
              </span>
            )}
          </div>
          {data.moods.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {data.moods.map((m) => (
                <Bar key={m.label} label={m.label} value={m.value} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
