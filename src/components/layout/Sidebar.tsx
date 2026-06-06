"use client";

import { useEffect, useState } from "react";
import { useIpodStore, type ScreenState } from "@/stores/ipod-store";
import { getPlaylists } from "@/server/actions/playlists";
import { usePlayerStore } from "@/stores/player-store";
import {
  AddIcon,
  AlbumIcon,
  ArtistIcon,
  HeartIcon,
  HomeIcon,
  MusicNoteIcon,
  PlayIcon,
  PlaylistIcon,
  SearchIcon,
  SettingsIcon,
  StatsIcon,
  TagIcon,
} from "@/components/icons";
import { PartyButton } from "@/components/party/PartyButton";

interface NavItemProps {
  label: string;
  icon: React.ReactNode;
  target: ScreenState;
  active?: boolean;
}

function NavItem({ label, icon, target, active }: NavItemProps) {
  const toRoot = useIpodStore((s) => s.toRoot);
  const push = useIpodStore((s) => s.push);

  return (
    <button
      type="button"
      onClick={() => {
        // Reset to a fresh stack rooted at the target.
        toRoot();
        if (target.name !== "home") push(target);
      }}
      className={
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition " +
        (active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100")
      }
    >
      <span className="text-zinc-300">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function Sidebar() {
  const current = useIpodStore((s) => s.current());
  const push = useIpodStore((s) => s.push);
  const toRoot = useIpodStore((s) => s.toRoot);

  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getPlaylists().then((r) => {
      if (cancelled) return;
      setPlaylists(r.map((p) => ({ id: p.id, name: p.name })));
    });
    return () => {
      cancelled = true;
    };
  }, [current.name]);

  const activeName = current.name;

  return (
    <nav className="flex h-full w-60 flex-col gap-1 overflow-y-auto bg-zinc-950 px-3 py-4">
      <div className="px-3 pb-3 text-lg font-bold tracking-tight text-zinc-100">
        Music<span className="text-emerald-500">.</span>
      </div>

      <NavItem
        label="Home"
        icon={<HomeIcon size={18} />}
        target={{ name: "home" }}
        active={activeName === "home"}
      />
      <NavItem
        label="Search"
        icon={<SearchIcon size={18} />}
        target={{ name: "search" }}
        active={activeName === "search"}
      />
      <NowPlayingNavItem activeName={activeName} />

      <div className="mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        Library
      </div>
      <NavItem
        label="Songs"
        icon={<MusicNoteIcon size={18} />}
        target={{ name: "songList" }}
        active={activeName === "songList"}
      />
      <NavItem
        label="Artists"
        icon={<ArtistIcon size={18} />}
        target={{ name: "artistList" }}
        active={activeName === "artistList" || activeName === "artistDetail"}
      />
      <NavItem
        label="Albums"
        icon={<AlbumIcon size={18} />}
        target={{ name: "albumList" }}
        active={activeName === "albumList" || activeName === "albumDetail"}
      />
      <NavItem
        label="Favorites"
        icon={<HeartIcon size={18} />}
        target={{ name: "favoritesList" }}
        active={activeName === "favoritesList"}
      />
      <NavItem
        label="Stats"
        icon={<StatsIcon size={18} />}
        target={{ name: "stats" }}
        active={activeName === "stats"}
      />
      <NavItem
        label="Tags"
        icon={<TagIcon size={18} />}
        target={{ name: "tagList" }}
        active={activeName === "tagList" || activeName === "tagDetail"}
      />

      <div className="mt-4 flex items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        <span>Playlists</span>
        <button
          type="button"
          onClick={() => {
            toRoot();
            push({ name: "newPlaylist" });
          }}
          className="text-zinc-500 hover:text-zinc-300"
          aria-label="New playlist"
          title="New playlist"
        >
          <AddIcon size={14} />
        </button>
      </div>

      {playlists.length === 0 && (
        <p className="px-3 py-1 text-[11px] text-zinc-600">No playlists yet</p>
      )}
      {playlists.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => {
            toRoot();
            push({ name: "playlistDetail", playlistId: p.id });
          }}
          className={
            "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] transition " +
            (activeName === "playlistDetail" &&
            "playlistId" in current &&
            current.playlistId === p.id
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-100")
          }
        >
          <PlaylistIcon size={14} />
          <span className="truncate">{p.name}</span>
        </button>
      ))}

      <div className="flex-1" />
      {/* ainul-only "Start listening party" — invisible to everyone else. */}
      <PartyButton />
      <NavItem
        label="Settings"
        icon={<SettingsIcon size={18} />}
        target={{ name: "settings" }}
        active={activeName === "settings"}
      />
    </nav>
  );
}

function NowPlayingNavItem({ activeName }: { activeName: string }) {
  const hasTrack = usePlayerStore((s) => s.currentIndex >= 0 && s.queue.length > 0);
  const toRoot = useIpodStore((s) => s.toRoot);
  const push = useIpodStore((s) => s.push);
  const active = activeName === "nowPlayingFull";

  return (
    <button
      type="button"
      disabled={!hasTrack}
      onClick={() => {
        toRoot();
        push({ name: "nowPlayingFull" });
      }}
      className={
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
        (active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100")
      }
    >
      <span className="text-zinc-300">
        <PlayIcon size={18} />
      </span>
      <span>Now Playing</span>
    </button>
  );
}
