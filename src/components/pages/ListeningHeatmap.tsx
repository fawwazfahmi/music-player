"use client";

import { useEffect, useState } from "react";
import { getListeningHeatmap, type HeatmapResult, type StatsRange } from "@/server/actions/stats";
import { PageLoading } from "./_shared";

// Hour-of-day × day-of-week, coloured by minutes listened.
//
// Sequential encoding (magnitude), so: one hue, light→dark, no rainbow. The
// hue is the app's emerald accent. The ramp starts at sky-700 rather than
// sky-950 because the darker steps fall below 3:1 against the zinc surface
// — a barely-listened hour would have been indistinguishable from an hour with
// no listening at all. "No data" is instead a neutral zinc, so empty reads by
// hue rather than by brightness.
export const RAMP = ["#0284c7", "#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd"];
const EMPTY = "rgba(63,63,70,0.4)"; // zinc-700/40

// Monday-first reading order; Postgres EXTRACT(DOW) is 0=Sunday.
const DAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Hovered {
  label: string;
  minutes: number;
  plays: number;
  x: number;
  y: number;
}

/**
 * Listening is heavily skewed — a handful of busy hours dwarf the rest — so a
 * linear ramp would flatten almost every cell into the lightest step. sqrt
 * spreads the low end without inventing a log scale nobody asked to read.
 */
export function bucketFor(seconds: number, max: number): number {
  if (seconds <= 0 || max <= 0) return -1;
  const step = Math.ceil(Math.sqrt(seconds / max) * RAMP.length);
  return Math.min(RAMP.length, Math.max(1, step)) - 1;
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function ListeningHeatmap({
  range,
  listener,
}: {
  range: StatsRange;
  listener: string | null;
}) {
  const [data, setData] = useState<HeatmapResult | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await getListeningHeatmap(listener, range);
      if (!cancelled) setData(r);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [listener, range]);

  if (!data) return <PageLoading message="Building heatmap…" />;

  const byKey = new Map(data.cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const totalHours = Math.round((data.totalSeconds / 3600) * 10) / 10;

  if (data.totalPlays === 0) {
    return (
      <p className="py-12 text-center text-sm text-zinc-500">
        No plays recorded in this range.
      </p>
    );
  }

  return (
    <div className="relative">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">When you listen</h3>
          <p className="text-xs text-zinc-500">
            {totalHours}h across {data.totalPlays} plays · times shown in{" "}
            {data.timeZone.replace("_", " ")}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {/* Hour axis — every third hour, so labels never collide. */}
          <div className="mb-1 grid grid-cols-[34px_repeat(24,minmax(0,1fr))] gap-[2px]">
            <div />
            {HOURS.map((h) => (
              <div key={h} className="text-center text-[9px] leading-none text-zinc-600">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
          </div>

          {DAYS.map((d) => (
            <div
              key={d.dow}
              className="mb-[2px] grid grid-cols-[34px_repeat(24,minmax(0,1fr))] items-center gap-[2px]"
            >
              <div className="pr-1 text-right text-[10px] text-zinc-500">{d.label}</div>
              {HOURS.map((h) => {
                const cell = byKey.get(`${d.dow}:${h}`);
                const seconds = cell?.seconds ?? 0;
                const plays = cell?.plays ?? 0;
                const b = bucketFor(seconds, data.maxSeconds);
                const minutes = Math.round(seconds / 60);
                const label =
                  plays > 0
                    ? `${d.label} ${fmtHour(h)} — ${minutes} min, ${plays} play${plays === 1 ? "" : "s"}`
                    : `${d.label} ${fmtHour(h)} — nothing played`;
                return (
                  <div
                    key={h}
                    role="img"
                    aria-label={label}
                    title={label}
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHovered({
                        label: `${d.label} ${fmtHour(h)}`,
                        minutes,
                        plays,
                        x: r.left + r.width / 2,
                        y: r.top,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                    className="h-[10px] w-full rounded-[2px] transition-transform hover:scale-y-[1.6] hover:scale-x-[1.15]"
                    style={{ background: b < 0 ? EMPTY : RAMP[b] }}
                  />
                );
              })}
            </div>
          ))}

          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-zinc-500">
            <span>Less</span>
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: EMPTY }} />
            {RAMP.map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      {hovered && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: hovered.x, top: hovered.y - 6 }}
        >
          <div className="font-semibold text-zinc-100">{hovered.label}</div>
          <div className="text-zinc-400">
            {hovered.plays > 0
              ? `${hovered.minutes} min · ${hovered.plays} play${hovered.plays === 1 ? "" : "s"}`
              : "Nothing played"}
          </div>
        </div>
      )}
    </div>
  );
}
