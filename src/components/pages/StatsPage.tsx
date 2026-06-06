"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getRecentlyPlayed,
  getStatsOverview,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  type RecentPlay,
  type StatsOverview,
  type StatsRange,
  type TopAlbum,
  type TopArtist,
  type TopTrack,
} from "@/server/actions/stats";
import { usePlayerStore } from "@/stores/player-store";
import { useIpodStore } from "@/stores/ipod-store";
import { coverUrl } from "@/lib/cover-url";
import { PageHeader, buildQueueTrack } from "./_shared";
import { PlayIcon } from "@/components/icons";
import { formatDuration } from "@/lib/format-duration";

type Tab = "tracks" | "artists" | "albums" | "recent";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "365d", label: "Last year" },
  { value: "all", label: "All time" },
];

const TABS: { value: Tab; label: string }[] = [
  { value: "tracks", label: "Top Tracks" },
  { value: "artists", label: "Top Artists" },
  { value: "albums", label: "Top Albums" },
  { value: "recent", label: "Recently Played" },
];

export function StatsPage() {
  const [tab, setTab] = useState<Tab>("tracks");
  const [range, setRange] = useState<StatsRange>("30d");

  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [tracks, setTracks] = useState<TopTrack[] | null>(null);
  const [artists, setArtists] = useState<TopArtist[] | null>(null);
  const [albums, setAlbums] = useState<TopAlbum[] | null>(null);
  const [recent, setRecent] = useState<RecentPlay[] | null>(null);

  // Refetch overview + active tab data when range or tab changes
  useEffect(() => {
    let cancelled = false;
    void getStatsOverview(range).then((r) => {
      if (!cancelled) setOverview(r);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    if (tab === "tracks") {
      setTracks(null);
      void getTopTracks(range).then((r) => !cancelled && setTracks(r));
    } else if (tab === "artists") {
      setArtists(null);
      void getTopArtists(range).then((r) => !cancelled && setArtists(r));
    } else if (tab === "albums") {
      setAlbums(null);
      void getTopAlbums(range).then((r) => !cancelled && setAlbums(r));
    } else if (tab === "recent") {
      setRecent(null);
      void getRecentlyPlayed().then((r) => !cancelled && setRecent(r));
    }
    return () => {
      cancelled = true;
    };
  }, [tab, range]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Stats" subtitle="Your listening" />

      <div className="border-b border-zinc-800/50 px-6 pb-3">
        <OverviewCards overview={overview} range={range} />
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-zinc-800/50 px-6 py-2">
        <div className="flex gap-1 text-xs">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={
                "rounded-full px-3 py-1.5 font-semibold transition " +
                (tab === t.value
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "recent" && (
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as StatsRange)}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {tab === "tracks" && <TopTracksList items={tracks} />}
        {tab === "artists" && <TopArtistsList items={artists} />}
        {tab === "albums" && <TopAlbumsList items={albums} />}
        {tab === "recent" && <RecentList items={recent} />}
      </div>
    </div>
  );
}

function OverviewCards({
  overview,
  range,
}: {
  overview: StatsOverview | null;
  range: StatsRange;
}) {
  const label = RANGES.find((r) => r.value === range)?.label ?? "";
  const hours = overview ? Math.round((overview.totalSeconds / 3600) * 10) / 10 : 0;

  return (
    <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4">
      <Stat label="Plays" value={overview?.totalPlays ?? "—"} sub={label} />
      <Stat label="Hours listened" value={overview ? hours : "—"} sub={label} />
      <Stat label="Unique tracks" value={overview?.uniqueTracks ?? "—"} sub={label} />
      <Stat label="Unique artists" value={overview?.uniqueArtists ?? "—"} sub={label} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-zinc-100">{value}</div>
      <div className="text-[10px] text-zinc-600">{sub}</div>
    </div>
  );
}

function useResolvedCoverUrl(hash: string | null, ytVideoId?: string | null): string | null {
  return useMemo(() => coverUrl(hash, ytVideoId), [hash, ytVideoId]);
}

function TopTracksList({ items }: { items: TopTrack[] | null }) {
  if (items === null) return <Loading />;
  if (items.length === 0) return <Empty />;

  const queue = items.map((t) =>
    buildQueueTrack({
      id: t.trackId,
      title: t.title,
      duration: t.duration,
      artistName: t.artist,
      albumTitle: t.album,
      coverArtHash: t.coverArtHash,
      ytVideoId: t.ytVideoId,
    }),
  );

  function playAt(idx: number) {
    usePlayerStore.getState().setQueue(queue, idx);
  }

  return (
    <ol className="space-y-1">
      {items.map((t, i) => (
        <li key={t.trackId}>
          <button
            type="button"
            onClick={() => playAt(i)}
            className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/50"
          >
            <span className="w-6 text-right text-xs text-zinc-500 tabular-nums">{i + 1}</span>
            <Cover hash={t.coverArtHash} ytVideoId={t.ytVideoId} alt={t.title} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">{t.title}</div>
              <div className="truncate text-xs text-zinc-500">{t.artist}</div>
            </div>
            <PlayCount n={t.playCount} />
            <span className="hidden text-emerald-400 group-hover:inline">
              <PlayIcon size={16} />
            </span>
            <span className="w-12 text-right text-xs text-zinc-600 tabular-nums">
              {formatDuration(t.duration)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TopArtistsList({ items }: { items: TopArtist[] | null }) {
  const push = useIpodStore((s) => s.push);
  if (items === null) return <Loading />;
  if (items.length === 0) return <Empty />;

  return (
    <ol className="space-y-1">
      {items.map((a, i) => (
        <li key={a.artistId}>
          <button
            type="button"
            onClick={() => push({ name: "artistDetail", artistId: a.artistId })}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/50"
          >
            <span className="w-6 text-right text-xs text-zinc-500 tabular-nums">{i + 1}</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-700 to-zinc-700 text-sm font-bold text-zinc-100">
              {a.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
              {a.name}
            </div>
            <PlayCount n={a.playCount} />
          </button>
        </li>
      ))}
    </ol>
  );
}

function TopAlbumsList({ items }: { items: TopAlbum[] | null }) {
  const push = useIpodStore((s) => s.push);
  if (items === null) return <Loading />;
  if (items.length === 0) return <Empty />;

  return (
    <ol className="space-y-1">
      {items.map((a, i) => (
        <li key={a.albumId}>
          <button
            type="button"
            onClick={() => push({ name: "albumDetail", albumId: a.albumId })}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/50"
          >
            <span className="w-6 text-right text-xs text-zinc-500 tabular-nums">{i + 1}</span>
            <Cover hash={a.coverArtHash} alt={a.title} square />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">{a.title}</div>
              <div className="truncate text-xs text-zinc-500">{a.artist}</div>
            </div>
            <PlayCount n={a.playCount} />
          </button>
        </li>
      ))}
    </ol>
  );
}

function RecentList({ items }: { items: RecentPlay[] | null }) {
  if (items === null) return <Loading />;
  if (items.length === 0) return <Empty />;

  const queue = items.map((t) =>
    buildQueueTrack({
      id: t.trackId,
      title: t.title,
      duration: t.duration,
      artistName: t.artist,
      albumTitle: t.album,
      coverArtHash: t.coverArtHash,
      ytVideoId: t.ytVideoId,
    }),
  );

  function playAt(idx: number) {
    usePlayerStore.getState().setQueue(queue, idx);
  }

  return (
    <ol className="space-y-1">
      {items.map((t, i) => (
        <li key={`${t.trackId}-${t.playedAt}`}>
          <button
            type="button"
            onClick={() => playAt(i)}
            className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/50"
          >
            <Cover hash={t.coverArtHash} ytVideoId={t.ytVideoId} alt={t.title} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">{t.title}</div>
              <div className="truncate text-xs text-zinc-500">{t.artist}</div>
            </div>
            <span className="w-24 text-right text-xs text-zinc-600">
              {relativeTime(t.playedAt)}
            </span>
            <span className="hidden text-emerald-400 group-hover:inline">
              <PlayIcon size={16} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Cover({
  hash,
  ytVideoId,
  alt,
  square,
}: {
  hash: string | null;
  ytVideoId?: string | null;
  alt: string;
  square?: boolean;
}) {
  const url = useResolvedCoverUrl(hash, ytVideoId);
  const cls = "h-9 w-9 shrink-0 " + (square ? "rounded" : "rounded");
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={alt} className={cls + " object-cover"} />
    );
  }
  return <div className={cls + " bg-gradient-to-br from-zinc-700 to-zinc-900"} />;
}

function PlayCount({ n }: { n: number }) {
  return (
    <span className="tabular-nums text-xs text-zinc-500">
      <span className="font-semibold text-zinc-300">{n}</span>
      <span className="ml-1 hidden md:inline">{n === 1 ? "play" : "plays"}</span>
    </span>
  );
}

function Loading() {
  return (
    <div className="py-12 text-center text-sm text-zinc-500">Loading…</div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-zinc-500">
      <span>Nothing here yet</span>
      <span className="text-xs text-zinc-600">
        Listen to a few songs all the way through and stats will fill in.
      </span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return new Date(iso).toLocaleDateString();
}
